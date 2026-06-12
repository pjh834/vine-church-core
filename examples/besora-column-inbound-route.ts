// app/api/besora/column/inbound/route.ts
//
// 베소라 프로젝트에 남는 "얇은 래퍼" — 교회별 설정값과
// verifyAdmin / adminDb / parseColumnFromEmail만 가지고
// vine-church-core의 공통 핸들러를 호출한다.

import { NextRequest, NextResponse } from "next/server";
import {
  handleColumnInbound,
  handleColumnInboundConfigCheck,
  type ColumnMailerConfig,
} from "@vine/church-core/column-mailer";
import { adminDb } from "@/lib/firebase/admin";
import { verifyAdmin } from "@/lib/auth/verifyAdmin";
import { parseColumnFromEmail } from "@/lib/column/parseColumn";

const WEBHOOK_PATH = "/api/besora/column/inbound";

const config: ColumnMailerConfig = {
  webhookSecret: process.env.RESEND_WEBHOOK_SECRET ?? "",
  allowedSenders: (process.env.COLUMN_SENDER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean),
  columnsCollection: "besora_columns",
  logsCollection: "column_inbound_logs",
  parseColumn: parseColumnFromEmail,
  adminDb,
  resendApiKey: process.env.RESEND_API_KEY,
};

// GET /api/besora/column/inbound — admin config check
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handleColumnInboundConfigCheck(WEBHOOK_PATH, config);
}

export async function POST(req: NextRequest) {
  return handleColumnInbound(req, config);
}
