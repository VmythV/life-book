ALTER TABLE "occurrences" DROP CONSTRAINT "occurrences_status";--> statement-breakpoint
ALTER TABLE "occurrences" ADD COLUMN "rescheduled_to" date;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_pending_rescheduled" CHECK ("occurrences"."status" <> 'pending' or "occurrences"."rescheduled_to" is not null);--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_status" CHECK ("occurrences"."status" in ('pending', 'completed', 'skipped'));