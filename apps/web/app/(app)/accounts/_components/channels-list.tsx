"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/datetime";
import { trpc } from "@/lib/trpc";

import { DeleteChannelButton } from "./delete-channel-button";
import { NewAccountSheet } from "./new-account-sheet";

export function ChannelsList() {
  const { data, isLoading } = trpc.channels.list.useQuery();

  if (isLoading) {
    return (
      <div className="flex flex-col rounded-md border">
        <Skeleton className="h-9 w-full rounded-none rounded-t-md" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4 border-t px-3 py-2.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="ml-auto h-4 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">先建一个自己的频道</p>
          <p className="max-w-md text-xs text-muted-foreground">
            频道是你的内容资产，沉淀定位与频道圣经；建好后在项目里绑定对标，操盘小鹅、灵感小鹅、神笔小鹅才能开工。
          </p>
        </div>
        <NewAccountSheet size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <NewAccountSheet size="sm" />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>平台</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((channel) => (
            <TableRow key={channel.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/accounts/${encodeURIComponent(channel.slug)}`}
                  className="hover:text-foreground hover:underline"
                >
                  {channel.name}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                  {channel.platform}
                </Badge>
              </TableCell>
              <TableCell className="max-w-xs truncate font-mono text-xs text-muted-foreground">
                {channel.platformUrl}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {formatDate(channel.createdAt)}
              </TableCell>
              <TableCell>
                <DeleteChannelButton id={channel.id} name={channel.name} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
