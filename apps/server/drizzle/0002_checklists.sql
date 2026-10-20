CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"group_name" text,
	"title" text NOT NULL,
	"notes" text,
	"quantity" numeric(12, 3),
	"unit" text,
	"is_done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"household_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_items_quantity" CHECK ("checklist_items"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "checklists" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text DEFAULT 'general' NOT NULL,
	"source_template_id" uuid,
	"due_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklists_purpose" CHECK ("checklists"."purpose" in ('general', 'shopping'))
);
--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_household_item_id_records_id_fk" FOREIGN KEY ("household_item_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_record" FOREIGN KEY ("record_id","user_id") REFERENCES "public"."records"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_record" FOREIGN KEY ("record_id","user_id") REFERENCES "public"."records"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_items_record" ON "checklist_items" USING btree ("user_id","record_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_items_active_purchase" ON "checklist_items" USING btree ("record_id","household_item_id") WHERE "checklist_items"."household_item_id" is not null and not "checklist_items"."is_done";