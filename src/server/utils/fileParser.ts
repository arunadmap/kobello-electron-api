import fs from "fs";
import path from "path";

/**
 * Parse markdown with file sections and write to folder
 */
export function parseAndSaveFiles(content: string, baseDir: string) {
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const fileRegex = /###\s+([\w.\-/]+)[\s\S]*?```[\w]*\n([\s\S]*?)```/g;

  let match;
  while ((match = fileRegex.exec(content)) !== null) {
    const fileName = match[1].trim();
    const fileContent = match[2].trim();

    const filePath = path.join(baseDir, fileName);
    console.log(`Writing file: ${filePath}`);
    
    const dirName = path.dirname(filePath);

    fs.mkdirSync(dirName, { recursive: true });
    fs.writeFileSync(filePath, fileContent, "utf8");
  }
}
