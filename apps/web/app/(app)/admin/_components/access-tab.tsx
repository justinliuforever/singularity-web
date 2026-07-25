"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { answerText, SUMMARY_QUESTION_IDS, surveyRows } from "@/lib/beta-survey";
import { trpc } from "@/lib/trpc";

import { MINUTE_PRESETS, statusBadge } from "./shared";

const BETA_STATUS_LABEL: Record<string, string> = {
  new: "新申请",
  contacted: "已联系",
  invited: "已邀请",
};

const BETA_PAGE_SIZE = 100;
const BETA_MAX_LIMIT = 500; // server caps listBetaApplications limit at 500

export function AccessTab() {
  return (
    <div className="flex flex-col gap-6">
      <BetaApplicationsCard />
      <RequestsCard />
      <AllowedEmailsCard />
      <CodesCard />
    </div>
  );
}

function BetaApplicationsCard() {
  const utils = trpc.useUtils();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(BETA_PAGE_SIZE);
  // The limit grows instead of paging by offset; since it is the query key, keepPreviousData
  // is what stops the list blanking mid-refetch.
  const apps = trpc.admin.listBetaApplications.useQuery(
    { limit },
    { placeholderData: keepPreviousData },
  );
  const rows = apps.data?.rows ?? [];
  const total = apps.data?.total ?? 0;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter((a) =>
        [a.email, a.wechat, a.social].some((v) => v?.toLowerCase().includes(q)),
      )
    : rows;

  const updateApp = trpc.admin.updateBetaApplication.useMutation({
    onSuccess: () => void utils.admin.listBetaApplications.invalidate(),
    onError: (err) => toast.error(err.message),
  });
  const inviteCode = trpc.admin.inviteBetaApplicationByCode.useMutation({
    onError: (err) => toast.error(err.message),
  });
  const allowEmail = trpc.admin.addAllowedEmail.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const sendCode = async (id: string) => {
    try {
      const created = await inviteCode.mutateAsync({ id });
      const copied = await navigator.clipboard
        .writeText(created.code)
        .then(() => true)
        .catch(() => false);
      toast.success(copied ? `准入码已生成并复制：${created.code}` : `准入码：${created.code}（复制失败，请手动记下）`);
      void utils.admin.listBetaApplications.invalidate();
      void utils.admin.listCodes.invalidate();
    } catch {
      // onError already toasted; swallow so the rejection isn't unhandled.
    }
  };

  const allowlist = async (id: string, email: string) => {
    try {
      const res = await allowEmail.mutateAsync({ email, note: "问卷邀请" });
      toast.success(res.approved > 0 ? "已加入白名单并放行该用户" : "已加入白名单，登录即放行");
      await updateApp.mutateAsync({ id, status: "invited" });
      void utils.admin.listAllowedEmails.invalidate();
    } catch {
      // onError already toasted; addAllowedEmail is idempotent so a retry is safe.
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>内测问卷申请</CardTitle>
        <CardDescription>
          来自落地页公开问卷（/apply）。发码 = 生成准入码并复制，通过邮件/微信手动发给对方；加白 = 该邮箱登录即自动放行
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索邮箱 / 微信 / 主账号"
            className="max-w-xs"
          />
          {rows.length < total ? (
            <span className="text-xs text-muted-foreground">
              共 {total} 份，已加载 {rows.length} 份
            </span>
          ) : null}
          {search ? (
            <span className="text-xs text-muted-foreground">仅过滤已加载的 {rows.length} 份</span>
          ) : null}
        </div>
        {filtered.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>申请时间</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>微信</TableHead>
                <TableHead>摘要</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const summary = SUMMARY_QUESTION_IDS.map((qid) => answerText(a.answers, qid))
                  .filter((v) => v.length > 0)
                  .join(" · ");
                const expanded = expandedId === a.id;
                return (
                  <Fragment key={a.id}>
                    <TableRow>
                      <TableCell
                        className="font-mono text-xs text-muted-foreground"
                        title={`提交于 ${new Date(a.createdAt).toLocaleString("zh-CN")}${a.submitCount > 1 ? `，最后更新 ${new Date(a.updatedAt).toLocaleString("zh-CN")}` : ""}`}
                      >
                        {new Date(a.createdAt).toLocaleDateString("zh-CN")}
                      </TableCell>
                      <TableCell className="text-xs">{a.email}</TableCell>
                      <TableCell className="text-xs">{a.wechat ?? "—"}</TableCell>
                      <TableCell className="max-w-56 text-xs">
                        <button
                          type="button"
                          className="text-left hover:underline"
                          onClick={() => setExpandedId(expanded ? null : a.id)}
                        >
                          {summary || "(点击查看)"}
                          {a.submitCount > 1 ? (
                            <span className="ml-1 text-muted-foreground">×{a.submitCount}</span>
                          ) : null}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            a.status === "invited"
                              ? "success"
                              : a.status === "contacted"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {BETA_STATUS_LABEL[a.status] ?? a.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {a.status === "new" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={updateApp.isPending}
                              onClick={() => updateApp.mutate({ id: a.id, status: "contacted" })}
                            >
                              已联系
                            </Button>
                          ) : null}
                          {a.status !== "invited" ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={inviteCode.isPending}
                                onClick={() => void sendCode(a.id)}
                              >
                                发码
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={allowEmail.isPending}
                                onClick={() => void allowlist(a.id, a.email)}
                              >
                                加白
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expanded ? (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/30">
                          <div className="flex flex-col gap-1.5 py-1 text-xs">
                            {surveyRows(a.answers).map((row) => (
                              <div key={row.id} className="flex gap-2">
                                <span className="shrink-0 text-muted-foreground">{row.title}</span>
                                <span>{row.value}</span>
                              </div>
                            ))}
                            {a.social ? (
                              <div className="flex gap-2">
                                <span className="shrink-0 text-muted-foreground">主账号</span>
                                {/^https?:\/\//i.test(a.social) ? (
                                  <a
                                    href={a.social}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline"
                                  >
                                    {a.social}
                                  </a>
                                ) : (
                                  <span>{a.social}</span>
                                )}
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            {apps.isLoading ? "加载中…" : search ? "没有匹配的申请" : "还没有问卷申请"}
          </p>
        )}
        {rows.length < total && limit < BETA_MAX_LIMIT ? (
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={apps.isFetching}
              onClick={() => setLimit((l) => Math.min(l + BETA_PAGE_SIZE, BETA_MAX_LIMIT))}
            >
              加载更多
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RequestsCard() {
  const utils = trpc.useUtils();
  const requests = trpc.admin.listRequests.useQuery();
  const decide = trpc.admin.decideRequest.useMutation({
    onSuccess: (res, vars) => {
      if (vars.decision === "approve") {
        toast.success(
          res.emailSent ? "已批准，通知邮件已发送" : "已批准（邮件未配置，请人工通知对方）",
        );
      } else {
        toast.success("已拒绝");
      }
      void utils.admin.listRequests.invalidate();
      void utils.admin.listUsers.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>内测申请</CardTitle>
        <CardDescription>批准后对方即可使用（配置邮件后会自动通知）</CardDescription>
      </CardHeader>
      <CardContent>
        {requests.data?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>申请人</TableHead>
                <TableHead>说明</TableHead>
                <TableHead>联系方式</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{r.displayName ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">{r.email}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-pre-wrap text-sm">
                    {r.message}
                  </TableCell>
                  <TableCell className="text-sm">{r.contact ?? "—"}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-right">
                    {r.status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ requestId: r.id, decision: "approve" })}
                        >
                          批准
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ requestId: r.id, decision: "reject" })}
                        >
                          拒绝
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            {requests.isLoading ? "加载中…" : "暂无申请"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AllowedEmailsCard() {
  const utils = trpc.useUtils();
  const allowed = trpc.admin.listAllowedEmails.useQuery();
  const [inviteEmail, setInviteEmail] = useState("");
  const addAllowed = trpc.admin.addAllowedEmail.useMutation({
    onSuccess: (res) => {
      toast.success(res.approved > 0 ? "已加入名单并放行该用户" : "已加入预邀请名单");
      setInviteEmail("");
      void utils.admin.listAllowedEmails.invalidate();
      void utils.admin.listUsers.invalidate();
      void utils.admin.listRequests.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const removeAllowed = trpc.admin.removeAllowedEmail.useMutation({
    onSuccess: () => void utils.admin.listAllowedEmails.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>预邀请邮箱</CardTitle>
        <CardDescription>名单内的邮箱登录后自动获得内测资格</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Input
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && inviteEmail.includes("@") && !addAllowed.isPending) {
                addAllowed.mutate({ email: inviteEmail });
              }
            }}
            placeholder="someone@example.com"
            className="max-w-sm"
          />
          <Button
            disabled={addAllowed.isPending || !inviteEmail.includes("@")}
            onClick={() => addAllowed.mutate({ email: inviteEmail })}
          >
            添加
          </Button>
        </div>
        {allowed.data?.length ? (
          <div className="flex flex-wrap gap-2">
            {allowed.data.map((a) => (
              <Badge key={a.email} variant="secondary" className="gap-1">
                {a.email}
                <button
                  type="button"
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  onClick={() => removeAllowed.mutate({ email: a.email })}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CodesCard() {
  const utils = trpc.useUtils();
  const codes = trpc.admin.listCodes.useQuery();
  const [codeMinutes, setCodeMinutes] = useState("100");
  const [codeAccess, setCodeAccess] = useState(false);
  const createCode = trpc.admin.createCode.useMutation({
    onSuccess: (created) => {
      const parts = [
        created.grant?.access ? "准入" : null,
        created.grant?.minutes ? `${created.grant.minutes} 分钟` : null,
      ].filter(Boolean);
      void navigator.clipboard.writeText(created.code).catch(() => {});
      toast.success(`已生成并复制：${created.code}（${parts.join(" + ")}）`);
      void utils.admin.listCodes.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const disableCode = trpc.admin.disableCode.useMutation({
    onSuccess: () => void utils.admin.listCodes.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>兑换码</CardTitle>
        <CardDescription>
          时长码在「用量与额度」页兑换，加到对方当月额度；勾选「内测准入」生成的码可在落地页/申请页激活内测资格（可与时长组合）
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={codeAccess ? "default" : "outline"}
            onClick={() => setCodeAccess((v) => !v)}
          >
            内测准入
          </Button>
          <span className="text-xs text-muted-foreground">+</span>
          {MINUTE_PRESETS.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={codeMinutes === String(p) ? "default" : "outline"}
              onClick={() => setCodeMinutes(codeMinutes === String(p) ? "" : String(p))}
            >
              {p} 分钟
            </Button>
          ))}
          <Input
            value={codeMinutes}
            onChange={(e) => setCodeMinutes(e.target.value.replace(/\D/g, ""))}
            className="w-24 font-mono"
            placeholder="自定义"
          />
          <Button
            disabled={createCode.isPending || (!codeAccess && !Number(codeMinutes))}
            onClick={() =>
              createCode.mutate({
                minutes: Number(codeMinutes) || undefined,
                access: codeAccess,
              })
            }
          >
            生成兑换码
          </Button>
        </div>
        {codes.data?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>码</TableHead>
                <TableHead>内容</TableHead>
                <TableHead>使用</TableHead>
                <TableHead>使用者</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.data.map((c) => {
                const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
                const exhausted = c.usedCount >= c.maxUses;
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="font-mono text-xs hover:underline"
                        title="点击复制"
                        onClick={() => {
                          void navigator.clipboard.writeText(c.code);
                          toast.success(`已复制 ${c.code}`);
                        }}
                      >
                        {c.code}
                      </button>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="flex items-center gap-1.5">
                        {c.grant?.access ? <Badge variant="outline">准入</Badge> : null}
                        {c.grant?.minutes ? `${c.grant.minutes} 分钟` : c.grant?.access ? null : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.usedCount}/{c.maxUses}
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.redeemers.length ? (
                        <div className="flex flex-col gap-0.5">
                          {c.redeemers.map((r, i) => (
                            <span key={i} title={new Date(r.redeemedAt).toLocaleString("zh-CN")}>
                              {r.email}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {expired ? (
                        <Badge variant="destructive">已失效</Badge>
                      ) : exhausted ? (
                        <Badge variant="secondary">已用完</Badge>
                      ) : (
                        <Badge variant="success">可用</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!expired && !exhausted ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disableCode.isPending}
                          onClick={() => disableCode.mutate({ codeId: c.id })}
                        >
                          作废
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
