import { Send, UserRound } from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "· · ·",
  robots: { index: false, follow: false },
};

export default function SecretPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-5 bg-background px-6">
      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button
          render={<a href="https://t.me/unbound_lab_assistant_bot" target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
          size="lg"
        >
          <Send data-icon="inline-start" />
          越狱 Bot
        </Button>
        <Button
          render={<a href="https://t.me/jujuzmz" target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
          variant="outline"
          size="lg"
        >
          <UserRound data-icon="inline-start" />
          加我
        </Button>
      </div>
    </main>
  );
}
