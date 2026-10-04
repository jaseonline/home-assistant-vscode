export interface FileAccessor {
  getFileContents(fileName: string): Promise<string>;
  /** Recursively list files; directories named in `ignoreDirs` are not descended into. */
  getFilesInFolder(subFolder: string, ignoreDirs?: string[]): Promise<string[]>;
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
