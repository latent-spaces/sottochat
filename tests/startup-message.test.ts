import { describe, expect, test } from "bun:test";
import { formatStartupMessage } from "../src/startup-message";

describe("startup message", () => {
  test("makes the browser URL the focal point without ANSI in plain output", () => {
    expect(formatStartupMessage("http://localhost:3737/")).toBe(`
##########################################################
#                                                        #
#   S O T T O - C H A T                                  #
#   Discuss the response. Answer well.                   #
#                                                        #
#   OPEN  >>>  http://localhost:3737/                    #
#                                                        #
#   Ctrl-C to stop                                       #
#                                                        #
##########################################################
`);
  });

  test("highlights the URL when color is enabled", () => {
    const message = formatStartupMessage("http://localhost:3737/", { color: true });

    expect(message).toContain("\x1b[1m\x1b[36m\x1b[4mhttp://localhost:3737/\x1b[0m");
  });

  test("does not show a stop hint for an existing server", () => {
    const message = formatStartupMessage("http://localhost:3737/", {
      alreadyRunning: true,
    });

    expect(message).toContain("Already running — welcome back");
    expect(message).not.toContain("Ctrl-C");
  });
});
