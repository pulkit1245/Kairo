-- when Kairo first reported an incident on its GitHub issue, and whether it opened the issue (P5e)
ALTER TABLE "Incident" ADD COLUMN "githubIssueAt" TIMESTAMP(3);
ALTER TABLE "Incident" ADD COLUMN "githubIssueOpened" BOOLEAN;
