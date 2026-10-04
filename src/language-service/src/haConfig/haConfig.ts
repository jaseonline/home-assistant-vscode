import * as path from "path";
import { FileAccessor } from "../fileAccessor";
import { HomeAssistantYamlFile } from "./haYamlFile";
import { ScriptReferences, HaFileInfo, IncludeReferences } from "./dto";

export class HomeAssistantConfiguration {
  /** Folder names never descended into when looking for root config files. */
  public static readonly rootDiscoveryIgnoredDirs = [
    "custom_components",
    "www",
    "node_modules",
    "tts",
    "deps",
    "__pycache__",
  ];

  private files: FilesCollection;

  private subFolder = "";

  public constructor(private fileAccessor: FileAccessor) {
    this.files = {};
  }

  public getFileAccessor(): FileAccessor {
    return this.fileAccessor;
  }

  public getAllFiles = (): HaFileInfo[] => {
    const allFiles: HaFileInfo[] = [];

    for (const [filename, yamlFile] of Object.entries(this.files)) {
      allFiles.push({
        filename,
        path: yamlFile.path,
      } as HaFileInfo);
    }
    return allFiles;
  };

  public updateFile = async (uri: string): Promise<FileUpdateResult> => {
    const filename = this.fileAccessor.fromUriToLocalPath(uri);

    let ourFile = this.files[filename];
    if (!ourFile) {
      return {
        isValidYaml: true,
        newFilesFound: true,
      };
    }
    const homeAssistantYamlFile = new HomeAssistantYamlFile(
      this.fileAccessor,
      filename,
      ourFile.path,
    );
    this.files[filename] = homeAssistantYamlFile;

    const validationResult = await homeAssistantYamlFile.isValid();
    if (!validationResult.isValid) {
      return {
        isValidYaml: false,
        newFilesFound: false,
      };
    }

    const files = await this.discoverCore(filename, ourFile.path, {});
    if (files !== undefined) {
      ourFile = files[filename];
      this.files[filename] = ourFile;

      for (const file in files) {
        if (!this.files[file]) {
          return {
            isValidYaml: true,
            newFilesFound: true,
          };
        }
      }
    }

    return {
      isValidYaml: true,
      newFilesFound: false,
    };
  };

  public removeFile = (uri: string): void => {
    const filename = this.fileAccessor.fromUriToLocalPath(uri);
    delete this.files[filename];
  };

  public getIncludes = async (): Promise<IncludeReferences> => {
    let results = [];
    for (const file of Object.values(this.files)) {
      results.push(file.getIncludes());
    }
    results = await Promise.all(results);

    let allIncludes = {};
    for (const result of results) {
      allIncludes = { ...allIncludes, ...result };
    }
    return allIncludes;
  };

  public getScripts = async (): Promise<ScriptReferences> => {
    let results = [];
    for (const filename of Object.keys(this.files)) {
      results.push(this.files[filename].getScripts());
    }
    results = await Promise.all(results);

    let allScripts = {};
    for (const result of results) {
      allScripts = { ...allScripts, ...result };
    }
    return allScripts;
  };

  private getRootFiles = async (): Promise<string[]> => {
    // Root discovery only needs a few files and folders. On a network mount
    // (SSHFS/SMB) every directory entry costs a round-trip, so avoid walking
    // the whole workspace: list the top level once, then only the folders HA
    // config can live in. Trees that never hold HA YAML (custom_components can
    // be 20k+ files) are skipped even in the fallback walk.
    // !include / !include_dir_* resolution is unaffected.
    const ignoreDirs = HomeAssistantConfiguration.rootDiscoveryIgnoredDirs;
    const ourFiles = [
      "configuration.yaml",
      "ui-lovelace.yaml",
      "automations.yaml",
    ];
    const ourFolders = [
      path.join("blueprints", "automation"),
      path.join("blueprints", "script"),
      path.join("blueprints", "template"),
      "automations",
      "custom_sentences",
    ];

    // Usual layout: the workspace is the HA config folder
    const topLevel = await this.fileAccessor.getFilesInFolder("", ignoreDirs, 0);
    const rootFiles = topLevel.filter((f) => ourFiles.includes(path.basename(f)));
    if (rootFiles.length > 0) {
      this.subFolder = path.dirname(rootFiles[0]);
      const folderFiles: string[] = [];
      for (const folder of ourFolders) {
        const files = await this.fileAccessor.getFilesInFolder(
          path.join(this.subFolder, folder),
          ignoreDirs,
        );
        folderFiles.push(...files.filter((f) => /\.ya?ml$/i.test(f)));
      }
      return [...rootFiles, ...folderFiles];
    }

    // Fallback: the HA config lives in a subfolder of the workspace
    const allFiles = await this.fileAccessor.getFilesInFolder("", ignoreDirs);
    const areOurFilesSomewhere = allFiles.filter((f) =>
      ourFiles.some((ourFile) => f.endsWith(ourFile)),
    );
    if (areOurFilesSomewhere.length > 0) {
      this.subFolder = areOurFilesSomewhere[0].substr(
        0,
        areOurFilesSomewhere[0].lastIndexOf(path.sep),
      );
    }
    return areOurFilesSomewhere;
  };

  public discoverFiles = async (): Promise<void> => {
    const rootFiles = await this.getRootFiles();

    let results = [];
    for (const rootFile of rootFiles) {
      results.push(
        this.discoverCore(
          rootFile,
          rootFile.substring(this.subFolder.length),
          this.files,
        ),
      );
    }
    results = await Promise.all(results);
    const result = results.pop();
    if (result !== undefined) {
      this.files = result;
    }
  };

  private discoverCore = async (
    filename: string,

    dirPath: string,
    files: FilesCollection,
  ): Promise<FilesCollection> => {
    if (dirPath.startsWith(path.sep)) {
      dirPath = dirPath.substring(1);
    }

    const homeAssistantYamlFile = new HomeAssistantYamlFile(
      this.fileAccessor,
      filename,
      dirPath,
    );
    files[filename] = homeAssistantYamlFile;

    let error = false;
    let errorMessage = `File '${filename}' could not be parsed, it was referenced from path '${dirPath}'.This file will be ignored.`;
    let includes: IncludeReferences = {};
    try {
      includes = await homeAssistantYamlFile.getIncludes();
    } catch (err) {
      error = true;
      errorMessage += ` Error message: ${err}`;
    }
    const validationResult = await homeAssistantYamlFile.isValid();
    if (!validationResult.isValid) {
      error = true;
      if (validationResult.errors && validationResult.errors.length > 0) {
        errorMessage += " Error(s): ";

        validationResult.errors.forEach((e) => (errorMessage += `\r\n - ${e}`));
      }
    }
    if (validationResult.warnings && validationResult.warnings.length > 0) {
      // validationResult.warnings.forEach(w => console.debug(`Warning parsing file ${filename}: ${w}`));
    }

    if (error) {
      if (filename === dirPath) {
        // root file has more impact
        console.warn(errorMessage);
      } else {
        console.log(errorMessage);
      }
      return files;
    }

    const results = [];
    for (const [filenameKey, include] of Object.entries(includes)) {
      if (Object.keys(files).some((x) => x === filenameKey)) {
        /// we already know this file
        continue;
      }
      results.push(this.discoverCore(filenameKey, include.path, files));
    }
    const fileCollections: FilesCollection[] = await Promise.all(results);
    return fileCollections[fileCollections.length - 1];
  };
}

export interface FilesCollection {
  [filename: string]: HomeAssistantYamlFile;
}
export interface FileUpdateResult {
  isValidYaml: boolean;
  newFilesFound: boolean;
}
