import Link from "next/link";
import type { Metadata } from "next";
import { CopySnippet } from "@/app/components/mcp/copy-snippet";
import { MCP_TOOL_GROUPS } from "@/app/lib/mcp/catalog";

export const metadata: Metadata = {
  title: "AI assistants (MCP)",
  description:
    "Connect Claude and other AI assistants to EFT Toolset's item scanner, item groups, gun builder, and raid planner through the Model Context Protocol.",
  alternates: { canonical: "/mcp" },
};

const CLIENTS = [
  {
    name: "Claude Code",
    note: "Run in a terminal:",
    template: "claude mcp add --transport http eft-toolset {endpoint}",
  },
  {
    name: "Claude (web and desktop)",
    note: "Open Settings, then Connectors, choose Add custom connector, and paste:",
    template: "{endpoint}",
  },
  {
    name: "VS Code",
    note: "Add to .vscode/mcp.json:",
    template: `{
  "servers": {
    "eft-toolset": { "type": "http", "url": "{endpoint}" }
  }
}`,
  },
  {
    name: "Cursor",
    note: "Add to .cursor/mcp.json or ~/.cursor/mcp.json:",
    template: `{
  "mcpServers": {
    "eft-toolset": { "url": "{endpoint}" }
  }
}`,
  },
  {
    name: "Clients that only run local servers",
    note: "Bridge with mcp-remote (requires Node.js):",
    template: `{
  "mcpServers": {
    "eft-toolset": { "command": "npx", "args": ["-y", "mcp-remote", "{endpoint}"] }
  }
}`,
  },
];

const EXAMPLES = [
  "What should I sell my LEDX, two GPUs, and a bitcoin for in PVE, and where?",
  "Build me a low-recoil M4A1 under 250,000 roubles with good ammo and give me the link.",
  "Compare that build with the default M4A1 preset.",
  "Plan a Customs raid from Crossroads to Dorms and out at Smugglers' Boat, with notes.",
  "Make an item group of every injector and give me a link to import it.",
];

export default function McpPage() {
  return (
    <main className="flex flex-1 justify-center p-4 pb-12">
      <article className="flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-2 pt-6">
          <h1 className="text-2xl font-black uppercase tracking-widest text-[#e6d9b8]">AI assistants</h1>
          <p className="text-sm leading-relaxed text-[#bbb]">
            Every EFT Toolset tool is available to AI assistants through the{" "}
            <a
              href="https://modelcontextprotocol.io"
              rel="noopener noreferrer"
              className="text-[#c8b384] underline underline-offset-2 hover:text-[#e6d9b8]"
            >
              Model Context Protocol
            </a>
            . Assistants get the same live tarkov.dev data, prices, and calculations as the app, for PVP and PVE. It is
            free, read-only, and needs no account.
          </p>
        </header>

        <section aria-labelledby="endpoint" className="flex flex-col gap-2">
          <h2 id="endpoint" className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
            Server URL
          </h2>
          <CopySnippet template="{endpoint}" label="server URL" />
          <p className="text-xs text-[#888]">Streamable HTTP. No sign-in or API key.</p>
        </section>

        <section aria-labelledby="connect" className="flex flex-col gap-4">
          <h2 id="connect" className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
            Connect
          </h2>
          {CLIENTS.map((client) => (
            <div key={client.name} className="flex flex-col gap-1.5">
              <h3 className="text-sm font-bold text-[#ddd]">{client.name}</h3>
              <p className="text-sm text-[#999]">{client.note}</p>
              <CopySnippet template={client.template} label={`${client.name} setup`} />
            </div>
          ))}
        </section>

        <section aria-labelledby="results" className="flex flex-col gap-2">
          <h2 id="results" className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
            Back into the app
          </h2>
          <p className="text-sm leading-relaxed text-[#bbb]">
            Builds and raid plans an assistant makes come with share links that open them here, ready to edit and save.
            For item groups, or several things at once, ask for an import link: it opens the{" "}
            <Link href="/data" className="text-[#c8b384] underline underline-offset-2 hover:text-[#e6d9b8]">
              Backup &amp; restore
            </Link>{" "}
            page with everything ready to merge into your data.
          </p>
        </section>

        <section aria-labelledby="tools" className="flex flex-col gap-4">
          <h2 id="tools" className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
            Tools
          </h2>
          {MCP_TOOL_GROUPS.map((group) => (
            <div key={group.tool} className="flex flex-col gap-1.5">
              <h3 className="text-sm font-bold text-[#ddd]">
                <Link href={group.href} className="hover:text-[#e6d9b8] hover:underline">
                  {group.tool}
                </Link>
              </h3>
              <ul className="divide-y divide-[#1a1a1a] border border-[#1a1a1a] bg-[#0c0c0c]">
                {group.tools.map((tool) => (
                  <li key={tool.name} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
                    <code className="shrink-0 font-mono text-xs text-[#c8b384] sm:w-40">{tool.name}</code>
                    <span className="text-sm text-[#999]">{tool.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section aria-labelledby="examples" className="flex flex-col gap-2">
          <h2 id="examples" className="text-xs font-bold uppercase tracking-widest text-[#9a8866]">
            Things to ask
          </h2>
          <ul className="flex flex-col gap-1.5 text-sm text-[#bbb]">
            {EXAMPLES.map((example) => (
              <li key={example} className="border-l-2 border-[#3a3326] pl-3">
                {example}
              </li>
            ))}
          </ul>
        </section>
      </article>
    </main>
  );
}
