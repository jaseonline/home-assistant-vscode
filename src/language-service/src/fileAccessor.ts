export interface FileAccessor {
  getFileContents(fileName: string): Promise<string>;
  /**
   * Recursively list files (absolute paths). Directories named in `ignoreDirs`
   * are not descended into; `maxDepth` 0 lists only the folder itself.
   */
  getFilesInFolder(subFolder: string, ignoreDirs?: string[], maxDepth?: number): Promise<string[]>;
  getFilesInFolderRelativeFrom(
    subFolder: string,
    relativeFrom: string,
  ): Promise<string[]>;
  getFilesInFolderRelativeFromAsFileUri(
    subFolder: string,
    relativeFrom: string,
  ): Promise<string[]>;
  getRelativePath(relativeFrom: string, filename: string): string;
  getRelativePathAsFileUri(relativeFrom: string, filename: string): string;
  fromUriToLocalPath(uri: string): string;
}
