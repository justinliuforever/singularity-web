"use client";

import { ArrowLeft, ArrowRight, Check, Clock3, ListChecks, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EMAIL_RE, SURVEY_QUESTIONS, SURVEY_VERSION, type SurveyQuestion } from "@/lib/beta-survey";
import { trpc } from "@/lib/trpc";

type Answers = Record<string, string | string[]>;
type Phase = "intro" | number | "contact" | "success";

const OTHER = "其他（请注明）";

export function ApplyForm() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [answers, setAnswers] = useState<Answers>({});
  const [email, setEmail] = useState("");
  const [wechat, setWechat] = useState("");
  const [social, setSocial] = useState("");
  const [website, setWebsite] = useState(""); // honeypot

  const submit = trpc.access.submitBetaApplication.useMutation({
    onSuccess: () => setPhase("success"),
  });

  const totalSteps = SURVEY_QUESTIONS.length + 1;
  const stepIndex = phase === "contact" ? totalSteps : typeof phase === "number" ? phase + 1 : 0;

  const setAnswer = (id: string, value: string | string[]) =>
    setAnswers((a) => ({ ...a, [id]: value }));

  // Picking "其他" commits you to specifying it, even on an otherwise optional question.
  const otherNeedsText = (q: SurveyQuestion): boolean => {
    const v = answers[q.id];
    const selected =
      q.allowOther && (q.type === "multi" ? Array.isArray(v) && v.includes(OTHER) : v === OTHER);
    if (!selected) return false;
    const text = answers[`${q.id}_other`];
    return typeof text !== "string" || text.trim().length === 0;
  };

  const canProceed = (q: SurveyQuestion): boolean => {
    if (otherNeedsText(q)) return false;
    const v = answers[q.id];
    if (!q.required) return true;
    if (q.type === "multi") return Array.isArray(v) && v.length > 0;
    return typeof v === "string" && v.length > 0;
  };

  const emailError =
    email.trim().length > 0 && !EMAIL_RE.test(email.trim())
      ? "请填写完整的邮箱地址，例如 you@example.com"
      : null;

  const next = () => {
    if (phase === "intro") setPhase(0);
    else if (typeof phase === "number") {
      if (phase + 1 < SURVEY_QUESTIONS.length) setPhase(phase + 1);
      else setPhase("contact");
    }
  };
  const back = () => {
    if (phase === "contact") setPhase(SURVEY_QUESTIONS.length - 1);
    else if (typeof phase === "number") {
      if (phase === 0) setPhase("intro");
      else setPhase(phase - 1);
    }
  };

  if (phase === "intro") {
    return (
      <div className="flex w-full max-w-xl flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h1 className="font-brand text-3xl sm:text-4xl">“开始”之前</h1>
          <p className="text-muted-foreground">感谢关注搬砖小鹅的每一位创作者</p>
        </div>
        <ul className="flex flex-col gap-3 text-sm leading-relaxed">
          <li className="flex gap-2.5">
            <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            这份问卷大约需要 1 分钟。
          </li>
          <li className="flex gap-2.5">
            <ListChecks className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            这不是用户调研——我们在找有真实创作需求、愿意一起打磨产品的首批伙伴。
          </li>
          <li className="flex gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            通过筛选后，我们会通过邮箱或微信与你联系，为你开通内测。
          </li>
          <li className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            提交即表示同意我们处理这些信息——仅用于内测筛选，我们不会做营销群发，也不会卖给第三方。
          </li>
        </ul>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {["约 1 分钟", `${totalSteps} 个问题`, "邮箱必填 · 其余联系方式选填", "仅用于内测筛选"].map((t) => (
            <span key={t} className="rounded-full border px-2.5 py-1">
              {t}
            </span>
          ))}
        </div>
        <div>
          <Button size="lg" onClick={next}>
            好，我们开始
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div className="flex w-full max-w-xl flex-col items-start gap-6">
        <span className="flex size-12 items-center justify-center rounded-full bg-poet/15">
          <Check className="size-6 text-poet-deep" />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="font-brand text-3xl">收到，申请已提交</h1>
          <p className="leading-relaxed text-muted-foreground">
            我们会分批审核，通过后与你联系为你开通内测。请留意 {email} 的收件箱
            {wechat ? "和微信好友申请" : ""}。
          </p>
        </div>
        <Button variant="outline" render={<Link href="/" />} nativeButton={false}>
          返回首页
        </Button>
      </div>
    );
  }

  const progress = Math.round((stepIndex / totalSteps) * 100);

  return (
    <div className="flex w-full max-w-xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
          <span>
            {String(stepIndex).padStart(2, "0")} / {String(totalSteps).padStart(2, "0")}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {phase === "contact" ? (
        <ContactStep
          email={email}
          wechat={wechat}
          social={social}
          emailError={emailError}
          setEmail={setEmail}
          setWechat={setWechat}
          setSocial={setSocial}
        />
      ) : (
        <QuestionStep
          question={SURVEY_QUESTIONS[phase]!}
          value={answers[SURVEY_QUESTIONS[phase]!.id]}
          otherText={answers[`${SURVEY_QUESTIONS[phase]!.id}_other`]}
          otherError={otherNeedsText(SURVEY_QUESTIONS[phase]!) ? "选了「其他」，请补充说明后继续" : null}
          setAnswer={setAnswer}
        />
      )}

      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="absolute -left-[9999px] top-0 h-px w-px opacity-0"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
      />

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={back}>
          <ArrowLeft data-icon="inline-start" />
          返回
        </Button>
        {phase === "contact" ? (
          <Button
            size="lg"
            disabled={!EMAIL_RE.test(email.trim()) || submit.isPending}
            onClick={() =>
              submit.mutate({
                email: email.trim().toLowerCase(),
                wechat: wechat.trim() || undefined,
                social: social.trim() || undefined,
                answers,
                surveyVersion: SURVEY_VERSION,
                website: website || undefined,
              })
            }
          >
            {submit.isPending ? "提交中…" : "提交申请"}
          </Button>
        ) : (
          <Button size="lg" disabled={!canProceed(SURVEY_QUESTIONS[phase]!)} onClick={next}>
            下一步
            <ArrowRight data-icon="inline-end" />
          </Button>
        )}
      </div>
      {submit.error ? <p className="text-xs text-destructive">{submit.error.message}</p> : null}
    </div>
  );
}

function QuestionStep({
  question: q,
  value,
  otherText,
  otherError,
  setAnswer,
}: {
  question: SurveyQuestion;
  value: string | string[] | undefined;
  otherText: string | string[] | undefined;
  otherError: string | null;
  setAnswer: (id: string, value: string | string[]) => void;
}) {
  const cur = q.type === "multi" ? (Array.isArray(value) ? value : []) : [];
  const selected = (opt: string) => (q.type === "multi" ? cur.includes(opt) : value === opt);
  const atCap = q.maxSelect !== undefined && cur.length >= q.maxSelect;

  const toggle = (opt: string) => {
    if (q.type !== "multi") {
      const nextVal = value === opt ? "" : opt;
      setAnswer(q.id, nextVal);
      if (nextVal !== OTHER) setAnswer(`${q.id}_other`, "");
      return;
    }
    let nextVal: string[];
    if (cur.includes(opt)) {
      nextVal = cur.filter((o) => o !== opt);
    } else if (q.exclusiveOption && opt === q.exclusiveOption) {
      nextVal = [opt];
    } else {
      const base = q.exclusiveOption ? cur.filter((o) => o !== q.exclusiveOption) : cur;
      if (q.maxSelect !== undefined && base.length >= q.maxSelect) return;
      nextVal = [...base, opt];
    }
    setAnswer(q.id, nextVal);
    if (!nextVal.includes(OTHER)) setAnswer(`${q.id}_other`, "");
  };

  const options = q.allowOther ? [...q.options, OTHER] : q.options;
  const showOther = q.allowOther && selected(OTHER);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold leading-snug">{q.title}</h2>
        <p className="text-xs text-muted-foreground">
          {q.hint ?? (q.type === "multi" ? "可多选" : "单选")}
          {q.required ? "" : " · 选填"}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((opt) => {
          const on = selected(opt);
          const capped =
            q.type === "multi" && atCap && !on && !(q.exclusiveOption && opt === q.exclusiveOption);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              aria-pressed={on}
              disabled={capped}
              className={`flex items-center justify-between gap-3 rounded-lg border p-3.5 text-left text-sm transition-colors ${
                on ? "border-primary bg-primary/5" : capped ? "opacity-40" : "hover:bg-muted/50"
              }`}
            >
              <span>{opt}</span>
              {on ? <Check className="size-4 shrink-0 text-primary" /> : null}
            </button>
          );
        })}
      </div>

      {showOther ? (
        <div className="flex flex-col gap-1.5">
          <Input
            value={typeof otherText === "string" ? otherText : ""}
            onChange={(e) => setAnswer(`${q.id}_other`, e.target.value)}
            placeholder="说说你的情况"
            maxLength={200}
            autoFocus
          />
          {otherError ? <p className="text-xs text-destructive">{otherError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ContactStep({
  email,
  wechat,
  social,
  emailError,
  setEmail,
  setWechat,
  setSocial,
}: {
  email: string;
  wechat: string;
  social: string;
  emailError: string | null;
  setEmail: (v: string) => void;
  setWechat: (v: string) => void;
  setSocial: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold leading-snug">请留下你的联系方式</h2>
        <p className="text-xs text-muted-foreground">邮箱必填，其余选填</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="apply-email">邮箱（必填）</Label>
        <Input
          id="apply-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          maxLength={200}
          aria-invalid={emailError ? true : undefined}
          aria-describedby="apply-email-hint"
        />
        <p
          id="apply-email-hint"
          className={emailError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        >
          {emailError ?? "内测邀请、产品更新都会从这里发。我们不会做营销群发，也不会卖给第三方。"}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="apply-wechat">微信号（选填）</Label>
        <Input
          id="apply-wechat"
          value={wechat}
          onChange={(e) => setWechat(e.target.value)}
          maxLength={100}
        />
        <p className="text-xs text-muted-foreground">
          如你希望更即时的反馈，我们会邀请你进入种子用户群。
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="apply-social">小红书 / X / 即刻 / B站 ID（选填）</Label>
        <Input
          id="apply-social"
          value={social}
          onChange={(e) => setSocial(e.target.value)}
          placeholder="ID 或主页链接"
          maxLength={200}
        />
        <p className="text-xs text-muted-foreground">
          如果你希望发布产品相关测评，我们会给予最大的资源扶持。
        </p>
      </div>
    </div>
  );
}
