declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionAPI {
    registerTool(tool: {
      name: string;
      label: string;
      description: string;
      parameters: any;
      execute: (
        toolCallId: string,
        params: any,
        signal: AbortSignal,
        onUpdate: any,
        ctx: any,
      ) => Promise<{
        content: Array<{ type: "text"; text: string }>;
        details: Record<string, any>;
      }>;
    }): void;
    on(
      event: "session_shutdown",
      handler: (event: any, ctx: any) => Promise<void>,
    ): void;
    exec(
      command: string,
      args: string[],
    ): Promise<{ stdout: string; code: number }>;
  }
}
