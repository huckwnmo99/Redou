import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";

interface AppTooltipProps {
  content: string;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export function AppTooltip({ content, children, side = "top" }: AppTooltipProps) {
  return (
    <Tooltip.Provider delayDuration={400}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={6}
            style={{
              background: "var(--color-bg-elevated)",
              color: "var(--color-text-secondary)",
              fontSize: "11px",
              padding: "4px 9px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              boxShadow: "var(--shadow-sm)",
              zIndex: 9999,
            }}
          >
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
