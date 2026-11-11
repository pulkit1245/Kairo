-- Gemini's answers, cached per commit sha and question (FR-20, P4)
CREATE TABLE "GeminiAnswer" (
    "id" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeminiAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeminiAnswer_commitSha_question_key" ON "GeminiAnswer"("commitSha", "question");
