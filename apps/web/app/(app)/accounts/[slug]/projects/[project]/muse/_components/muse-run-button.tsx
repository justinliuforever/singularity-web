"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { MuseStartSheet, type MuseCompetitor } from "./muse-start-sheet";

type Props = {
  channelId: string;
  projectId: string;
  channelName: string;
  competitors: MuseCompetitor[];
  isActive: boolean;
  accountSlug: string;
  projectSlug: string;
};

export function MuseRunButton({
  channelId,
  projectId,
  channelName,
  competitors,
  isActive,
  accountSlug,
  projectSlug,
}: Props) {
  const competitorCount = competitors.length;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {isActive ? (
          <Button disabled size="sm">
            <Loader2 data-icon="inline-start" className="animate-spin" />
            巡视中…
          </Button>
        ) : (
          <MuseStartSheet
            channelId={channelId}
            projectId={projectId}
            channelName={channelName}
            competitors={competitors}
            disabled={competitorCount === 0}
          />
        )}
      </div>
      {competitorCount === 0 ? (
        <Link
          href={`/accounts/${encodeURIComponent(accountSlug)}/projects/${encodeURIComponent(projectSlug)}`}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          先去绑定对标
        </Link>
      ) : null}
    </div>
  );
}
