"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Gauge, Plus, ScanSearch, ShieldCheck, Tv } from "lucide-react";

import { NewAccountSheet } from "@/app/(app)/accounts/_components/new-account-sheet";
import { GooseMark } from "@/components/goose-mark";
import { Wordmark } from "@/components/wordmark";
import type { SidebarAccount } from "@/lib/sidebar-data";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

// SOP 库 is now a tab inside Clerk (clerk-tabs.tsx), not its own nav slot.
const ANALYSIS = [
  { label: "操盘小鹅", href: "/clerk", icon: ScanSearch },
  { label: "用量与额度", href: "/usage", icon: Gauge },
];

export function AppSidebar({
  accounts,
  isAdmin = false,
}: {
  accounts: SidebarAccount[];
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [accountsOpen, setAccountsOpen] = useState(true);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const accountActive = (slug: string) => {
    const base = `/accounts/${encodeURIComponent(slug)}`;
    return pathname === base || pathname.startsWith(`${base}/`);
  };

  return (
    <Sidebar>
      <SidebarHeader className="px-6 pt-10 pb-6">
        <Link href="/" className="brand-lockup flex items-center gap-2.5 text-2xl leading-none">
          <GooseMark className="size-7 shrink-0" />
          <Wordmark />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>分析与素材</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ANALYSIS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton render={<Link href={item.href} />} isActive={isActive(item.href)}>
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <button
            type="button"
            onClick={() => setAccountsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>我的账号</span>
            <ChevronDown
              className={`size-3.5 transition-transform ${accountsOpen ? "" : "-rotate-90"}`}
            />
          </button>
          {accountsOpen ? (
            <SidebarGroupContent>
              <SidebarMenu>
                {accounts.map((a) => (
                  <SidebarMenuItem key={a.slug}>
                    <SidebarMenuButton
                      render={<Link href={`/accounts/${encodeURIComponent(a.slug)}`} />}
                      isActive={accountActive(a.slug)}
                    >
                      <Tv />
                      <span className="truncate">{a.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                <SidebarMenuItem>
                  <NewAccountSheet
                    trigger={
                      <SidebarMenuButton className="text-muted-foreground">
                        <Plus />
                        <span>新建账号</span>
                      </SidebarMenuButton>
                    }
                  />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          ) : null}
        </SidebarGroup>

        {isAdmin ? (
          <SidebarGroup>
            <SidebarGroupLabel>管理</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton render={<Link href="/admin" />} isActive={isActive("/admin")}>
                    <ShieldCheck />
                    <span>管理后台</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
    </Sidebar>
  );
}
