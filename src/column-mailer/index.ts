import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";

// ---------------------------------------------------------------------------
// 공통 유틸 (인박스 핸들러가 의존하는 작은 헬퍼들)
// 필요하면 별도 파일(html.ts 등)로 더 쪼갤 수 있음
// ---------------------------------------------------------------------------

/** 매우 단순한 HTML → 텍스트 변환. 기존 lib/server/utils의 htmlToText와 동일한 역할. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "홍길동 <hong@example.com>" 또는 "hong@example.com" 에서 이메일만 추출 */
export function extractSenderEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  const email = match ? match[1] : from;
  return email.trim().toLowerCase();
}

/** 허용된 발신자 목록(소문자 비교)에 포함되는지 확인 */
export function isAllowedSender(
  senderEmail: string,
  allowedSenders: string[]
): boolean {
  const normalized = senderEmail.trim().toLowerCase();
  return allowedSenders
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

interface ResendWebhookPayload {
  type: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    text: string | null;
    html: string | null;
  };
}

/**
 * 파싱된 컬럼/주보 데이터의 최소 형태.
 * 교회별 parseColumn 함수가 이보다 더 많은 필드를 반환해도 무방하며,
 * 그 값들은 그대로 Firestore에 저장된다.
 */
export interface ParsedColumnBase {
  /** Firestore 문서 ID로 사용됨 (예: 날짜 기반 슬러그) */
  id: string;
  [key: string]: unknown;
}

export interface ColumnMailerConfig<
  TColumn extends ParsedColumnBase = ParsedColumnBase
> {
  /** Resend 웹훅 서명 검증용 시크릿 (RESEND_WEBHOOK_SECRET) */
  webhookSecret: string;
  /** 컬럼 메일을 보낼 수 있는 허용된 발신자 이메일 목록 */
  allowedSenders: string[];
  /** 파싱된 컬럼을 저장할 Firestore 컬렉션명 (예: "besora_columns") */
  columnsCollection: string;
  /** 처리 로그를 남길 Firestore 컬렉션명 (예: "besora_column_inbound_logs") */
  logsCollection: string;
  /**
   * 메일 제목/본문에서 컬럼 데이터를 추출하는 함수.
   * 교회마다 양식이 다를 수 있어 각 프로젝트에서 구현해 주입한다.
   * 파싱 실패 시 null을 반환하면 "parse_failed"로 로깅된다.
   */
  parseColumn: (subject: string, text: string) => TColumn | null;
  /** 이 교회의 Firebase 프로젝트에 연결된 Firestore Admin 인스턴스 */
  adminDb: Firestore;
  /** Resend API 키. 본문이 누락된 경우 email_id로 재조회할 때 사용 (선택) */
  resendApiKey?: string;
}

// ---------------------------------------------------------------------------
// GET — 관리자용 설정 확인
// ---------------------------------------------------------------------------

/**
 * 관리자 인증은 호출하는 라우트에서 verifyAdmin으로 먼저 처리한다고 가정.
 * 이 함수는 그 이후 "현재 웹훅 설정이 어떻게 되어 있는지"만 보여준다.
 */
export function handleColumnInboundConfigCheck(
  webhookPath: string,
  config: Pick<ColumnMailerConfig, "webhookSecret" | "allowedSenders">
): NextResponse {
  return NextResponse.json({
    hasWebhookSecret: !!config.webhookSecret,
    allowedSenders: config.allowedSenders,
    webhookPath,
  });
}

// ---------------------------------------------------------------------------
// POST — Resend 인바운드 웹훅 처리
// ---------------------------------------------------------------------------

export async function handleColumnInbound<TColumn extends ParsedColumnBase>(
  req: NextRequest,
  config: ColumnMailerConfig<TColumn>
): Promise<NextResponse> {
  const { webhookSecret: secret, adminDb, allowedSenders, columnsCollection, logsCollection, parseColumn, resendApiKey } = config;

  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // svix 서명 또는 URL 토큰 인증
  const urlToken = req.nextUrl.searchParams.get("token");
  const hasSvix = req.headers.has("svix-id");

  let webhookData: Record<string, unknown>;

  if (urlToken) {
    if (urlToken !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    if (body.type !== "email.received") return NextResponse.json({ ok: true });
    webhookData = body.data as Record<string, unknown>;
  } else if (hasSvix) {
    const { Webhook } = await import("svix");
    const rawBody = await req.text();
    let payload: ResendWebhookPayload;
    try {
      const wh = new Webhook(secret);
      payload = wh.verify(rawBody, {
        "svix-id": req.headers.get("svix-id")!,
        "svix-timestamp": req.headers.get("svix-timestamp")!,
        "svix-signature": req.headers.get("svix-signature")!,
      }) as ResendWebhookPayload;
    } catch {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    if (payload.type !== "email.received") return NextResponse.json({ ok: true });
    webhookData = payload.data as unknown as Record<string, unknown>;
  } else {
    return NextResponse.json({ error: "Missing auth" }, { status: 401 });
  }

  const from = typeof webhookData.from === "string" ? webhookData.from : "";
  const subject = typeof webhookData.subject === "string" ? webhookData.subject : "";
  const emailId = typeof webhookData.email_id === "string" ? webhookData.email_id : null;
  let rawText = typeof webhookData.text === "string" ? webhookData.text : null;
  let rawHtml = typeof webhookData.html === "string" ? webhookData.html : null;

  // Resend inbound webhook omits body — fetch via API when missing
  if (!rawText && !rawHtml && emailId && resendApiKey) {
    const res = await fetch(`https://api.resend.com/emails/${emailId}`, {
      headers: { Authorization: `Bearer ${resendApiKey}` },
    });
    if (res.ok) {
      const full = (await res.json()) as { text?: string; html?: string };
      rawText = full.text ?? null;
      rawHtml = full.html ?? null;
    }
  }

  const logRef = adminDb.collection(logsCollection).doc();
  const logBase = {
    from,
    subject: subject || null,
    receivedAt: new Date().toISOString(),
    rawFields: Object.keys(webhookData),
  };

  const senderEmail = extractSenderEmail(from);
  if (!isAllowedSender(senderEmail, allowedSenders)) {
    logRef.set({ ...logBase, skip: "unauthorized_sender", senderEmail }).catch(() => {});
    return NextResponse.json({ ok: true, skip: "unauthorized_sender", from: senderEmail });
  }

  if (!subject) {
    logRef.set({ ...logBase, skip: "missing_subject" }).catch(() => {});
    return NextResponse.json({ ok: true, skip: "missing_subject" });
  }

  const text = rawText?.trim() || htmlToText(rawHtml ?? "");
  if (!text) {
    logRef
      .set({ ...logBase, skip: "empty_body", rawText, rawHtmlLength: rawHtml?.length ?? 0 })
      .catch(() => {});
    return NextResponse.json({ ok: true, skip: "empty_body" });
  }

  const column = parseColumn(subject, text);
  if (!column) {
    const preview = text.slice(0, 300);
    logRef.set({ ...logBase, skip: "parse_failed", textPreview: preview }).catch(() => {});
    return NextResponse.json({ ok: true, skip: "parse_failed", textPreview: preview });
  }

  await adminDb.collection(columnsCollection).doc(column.id).set({
    ...column,
    createdAt: new Date().toISOString(),
  });
  logRef.set({ ...logBase, skip: null, savedId: column.id }).catch(() => {});

  return NextResponse.json({ ok: true, id: column.id });
}
