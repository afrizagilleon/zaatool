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

/**
 * `--password <value>` is refused rather than honoured. A value on the command line lands in
 * the shell history, in `ps` for as long as the command runs, and in whatever records the
 * container's exec calls (`docker events`, an audit daemon). Throws, with the way to do it
 * instead, when the flag is present.
 */
export function refusePasswordFlag(args: string[]): void {
  if (args.some((arg) => arg === "--password" || arg.startsWith("--password="))) {
    throw new Error(
      "--password is not accepted: a password on the command line ends up in shell history and in the process list. " +
        "Leave it out to be asked at a hidden prompt, or pipe it in with --password-stdin " +
        "(for example: printf '%s' \"$PW\" | pnpm create-user <name> --role viewer --password-stdin)."
    );
  }
}

/** Everything on stdin, minus the trailing newline an `echo` adds. For `--password-stdin`. */
export async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const value = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
  if (!value) throw new Error("--password-stdin was given but nothing arrived on stdin.");
  return value;
}
