-- CreateEnum
CREATE TYPE "ComponentType" AS ENUM ('EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG');

-- AlterTable
ALTER TABLE "Component" ADD COLUMN "type" "ComponentType" NOT NULL DEFAULT 'TASK';
ALTER TABLE "Component" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Component" ADD COLUMN "owner" TEXT;
ALTER TABLE "Component" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Component" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE INDEX "Component_parentId_idx" ON "Component"("parentId");
CREATE INDEX "Component_type_idx" ON "Component"("type");
CREATE INDEX "Component_externalId_idx" ON "Component"("externalId");

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Component"("id") ON DELETE SET NULL ON UPDATE CASCADE;
