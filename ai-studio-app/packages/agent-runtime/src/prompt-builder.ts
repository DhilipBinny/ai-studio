import type { AgentConfig } from "./types";

export function buildSystemPrompt(
  agent: AgentConfig,
  options?: { timezone?: string },
): string {
  const persona = agent.persona || {};
  const hasPersona = persona.identity || persona.instructions || persona.tone || persona.context;

  if (!hasPersona && agent.systemPrompt) {
    let prompt = agent.systemPrompt;
    if (agent.rules.length > 0) {
      prompt += "\n\n## Rules\n" + agent.rules
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
        .map((r) => `- ${r.rule}`).join("\n");
    }
    return prompt;
  }

  const sections: string[] = [];

  sections.push(`You are ${agent.name}.`);

  if (persona.identity) {
    sections.push(`## Identity\n${persona.identity}`);
  } else if (agent.description) {
    sections.push(`## Identity\n${agent.description}`);
  }

  if (persona.instructions) {
    sections.push(`## Instructions\n${persona.instructions}`);
  }

  if (persona.tone) {
    sections.push(`## Communication Style\n${persona.tone}`);
  }

  if (persona.context) {
    sections.push(`## Context\n${persona.context}`);
  }

  if (agent.rules.length > 0) {
    sections.push("## Rules\n" + agent.rules
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((r) => `- ${r.rule}`).join("\n"));
  }

  const tz = options?.timezone || "UTC";
  const now = new Date();
  sections.push(`Current date and time: ${now.toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" })} (${tz})`);

  return sections.join("\n\n");
}
