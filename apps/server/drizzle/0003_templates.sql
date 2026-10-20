CREATE TABLE "checklist_template_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"group_name" text,
	"title" text NOT NULL,
	"quantity" numeric(12, 3),
	"unit" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "checklist_template_items_quantity" CHECK ("checklist_template_items"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_templates_id_user" UNIQUE("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_template" FOREIGN KEY ("template_id","user_id") REFERENCES "public"."checklist_templates"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_template_items_template" ON "checklist_template_items" USING btree ("user_id","template_id");--> statement-breakpoint
CREATE INDEX "checklist_templates_user" ON "checklist_templates" USING btree ("user_id","updated_at" DESC NULLS LAST);