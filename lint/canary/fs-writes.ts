import fs from "node:fs";

export const drop = (filePath: string) => fs.rmSync(filePath);
