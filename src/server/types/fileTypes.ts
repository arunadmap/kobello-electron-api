export interface FileInputBase {
    fileName: string;
    filePath?: string;
    basePath?: string;
}

export interface CreateFileInput extends FileInputBase {
    content: string;

}

export interface UpdateFileInput extends FileInputBase {
    content: string;
}

export interface FileDetails {
    path: string;
    name: string;
    size: number;
    createdAt: Date;
    ino: number;
    uid: number;
    ext: string;
}

export interface FileItem {

    type: "file" | "folder";
    name: string;
    path: string;
    children?: FileItem[];
}