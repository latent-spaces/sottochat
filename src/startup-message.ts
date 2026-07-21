const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  underline: "\x1b[4m",
} as const;

export function formatStartupMessage(
  url: string,
  options: { alreadyRunning?: boolean; color?: boolean; authHint?: boolean } = {}
): string {
  const color = options.color ?? false;
  const hook = "Discuss the response. Answer well.";
  const status = options.alreadyRunning ? "Already running — welcome back" : hook;
  const displayUrl = color
    ? `${ANSI.bold}${ANSI.cyan}${ANSI.underline}${url}${ANSI.reset}`
    : url;
  const width = Math.max(58, url.length + 18);
  const border = "#".repeat(width);
  const edge = color ? `${ANSI.cyan}#${ANSI.reset}` : "#";
  const line = (content = "") => `${edge}${content.padEnd(width - 2)}${edge}`;
  const title = "S O T T O - C H A T";
  const titleLine = line(`   ${title}`).replace(
    title,
    color ? `${ANSI.bold}${title}${ANSI.reset}` : title
  );
  const urlPrefix = "   OPEN  >>>  ";
  const urlPadding = " ".repeat(width - 2 - urlPrefix.length - url.length);
  const urlLine = `${edge}${urlPrefix}${displayUrl}${urlPadding}${edge}`;
  const displayBorder = color ? `${ANSI.bold}${ANSI.cyan}${border}${ANSI.reset}` : border;
  const lines = [
    displayBorder,
    line(),
    titleLine,
    line(`   ${status}`),
    line(),
    urlLine,
    line(),
  ];

  if (options.authHint) {
    for (const hint of [
      "   chat & summaries need a Claude Code login",
      "   run `claude` once to sign in",
    ]) {
      lines.push(line(hint).replace(hint, color ? `${ANSI.dim}${hint}${ANSI.reset}` : hint));
    }
    lines.push(line());
  }
  if (!options.alreadyRunning) {
    const hint = "   Ctrl-C to stop";
    const hintLine = line(hint).replace(
      hint,
      color ? `${ANSI.dim}${hint}${ANSI.reset}` : hint
    );
    lines.push(hintLine, line());
  }
  lines.push(displayBorder);

  return `\n${lines.join("\n")}\n`;
}

export function terminalSupportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && !("NO_COLOR" in Bun.env);
}
