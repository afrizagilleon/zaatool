import readline from "node:readline";

export function promptPassword(promptText = "Password: "): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let muted = false;
    const originalWrite = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = function (stringToWrite: string) {
      if (muted) {
        return;
      }
      if (originalWrite) {
        originalWrite.call(this, stringToWrite);
      } else {
        process.stdout.write(stringToWrite);
      }
    };

    process.stdout.write(promptText);
    muted = true;

    rl.question("", (answer) => {
      muted = false;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}
