# @vine/church-core

The Vine Digital의 교회 사이트들이 공통으로 쓰는 백엔드 로직 모음.
프론트엔드(디자인)는 각 교회 프로젝트에 그대로 두고, **화면 없이 동작만 하는
함수들만** 여기로 옮긴다.

## 설치 (옵션 B: GitHub 레포로 설치)

```json
// 각 교회 프로젝트의 package.json
"dependencies": {
  "@vine/church-core": "github:josephname/vine-church-core"
}
```

---

## 1. column-mailer — 컬럼/주보 이메일 자동 업로드 ✅ (추출 완료)

베소라의 `app/api/besora/column/inbound/route.ts`에서 추출.

### 핵심 아이디어

- **공통 로직** (이 모듈에 포함): Svix 서명 검증, URL 토큰 검증, Resend API
  fallback 조회, 허용 발신자 체크, HTML→텍스트 변환, 로그 기록 패턴
- **교회별 설정** (`ColumnMailerConfig`로 주입):
  - `webhookSecret`, `allowedSenders` — Resend 계정별로 다름
  - `columnsCollection`, `logsCollection` — Firestore 컬렉션명
  - `parseColumn` — 메일 제목/본문 파싱 규칙 (교회마다 양식이 다를 수 있어
    각 프로젝트의 `lib/column/parseColumn.ts`를 그대로 주입)
  - `adminDb` — 그 교회의 Firebase 프로젝트에 연결된 Firestore Admin
    인스턴스 (각 프로젝트가 생성해서 주입)

### 사용 예시

`examples/besora-column-inbound-route.ts` 참고. 라우트 파일은 설정값 +
`verifyAdmin`/`adminDb`/`parseColumnFromEmail` import만 남고, 실제 처리
로직은 `handleColumnInbound` / `handleColumnInboundConfigCheck` 호출 한 줄로 줄어든다.

### 적용 시 체크리스트

- [ ] 베소라: 기존 `route.ts`를 `examples/besora-column-inbound-route.ts`
      형태로 교체 → 배포 후 실제 이메일 1건으로 테스트
- [ ] 컬렉션명이 정확히 일치하는지 확인 (`besora_columns`,
      `column_inbound_logs`) — 오타 나면 기존 데이터와 분리되어 버림
- [ ] `parseColumnFromEmail`은 각 프로젝트의 `lib/column/parseColumn.ts`에
      그대로 둠 (core로 옮기지 않음)
- [ ] 주만나/이룸에 같은 기능이 있다면, 동일한 패턴으로 적용 후
      교회별 `parseColumn` 구현만 다르게 작성

### 미해결 질문 (다음에 같이 정하기)

1. **로그 컬렉션명도 교회별로 분리할까?**
   원본 코드는 `column_inbound_logs`로 고정돼 있었음. 교회별 Firebase
   프로젝트가 분리돼 있으니 충돌은 없지만, 나중에 여러 교회 로그를 한
   대시보드에서 보려면 컬렉션명 규칙(`{church}_column_inbound_logs`)을
   통일하는 게 좋을 수 있음.
2. **`htmlToText`는 단순 정규식 버전으로 재작성했음** — 원본의
   `lib/server/utils.ts` 구현과 동작이 100% 동일한지 베소라에 적용할 때
   한 번 비교 확인 필요.

---

## 다음 모듈 (예정)

- [ ] `youtube-sync` — 유튜브 RSS 동기화
- [ ] `gallery-upload` — 앨범/갤러리 업로드 (Sharp.js 변환)
- [ ] `auth` — Firebase Auth 관리자 인증 (`verifyAdmin` 등 공통화 검토)
