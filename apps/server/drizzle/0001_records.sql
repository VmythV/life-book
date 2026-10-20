CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_id_user" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "important_dates" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"repeat" text NOT NULL,
	"year" smallint,
	"month" smallint NOT NULL,
	"day" smallint NOT NULL,
	"start_year" smallint,
	"show_counter" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "important_dates_kind" CHECK ("important_dates"."kind" in ('birthday', 'anniversary', 'expiry', 'other')),
	CONSTRAINT "important_dates_repeat" CHECK ("important_dates"."repeat" in ('once', 'yearly')),
	CONSTRAINT "important_dates_year" CHECK (("important_dates"."repeat" = 'once') = ("important_dates"."year" is not null)),
	CONSTRAINT "important_dates_month" CHECK ("important_dates"."month" between 1 and 12),
	CONSTRAINT "important_dates_day" CHECK ("important_dates"."day" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "occurrences" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"occurrence_date" date NOT NULL,
	"status" text NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occurrences_record_date" UNIQUE("record_id","occurrence_date"),
	CONSTRAINT "occurrences_status" CHECK ("occurrences"."status" in ('completed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "record_tags" (
	"user_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_tags_pk" PRIMARY KEY("record_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"notes" text,
	"category_id" uuid,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "records_id_user" UNIQUE("id","user_id"),
	CONSTRAINT "records_type" CHECK ("records"."type" in ('recurring', 'important_date', 'memo', 'checklist', 'household_item'))
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"freq" text NOT NULL,
	"interval" smallint DEFAULT 1 NOT NULL,
	"by_weekdays" smallint[],
	"by_month_day" smallint,
	"time_of_day" time,
	"end_type" text DEFAULT 'never' NOT NULL,
	"until_date" date,
	"count" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_freq" CHECK ("recurring_rules"."freq" in ('daily', 'weekly', 'monthly', 'yearly')),
	CONSTRAINT "recurring_rules_interval" CHECK ("recurring_rules"."interval" >= 1),
	CONSTRAINT "recurring_rules_month_day" CHECK ("recurring_rules"."by_month_day" between 1 and 31),
	CONSTRAINT "recurring_rules_end_type" CHECK ("recurring_rules"."end_type" in ('never', 'until', 'count')),
	CONSTRAINT "recurring_rules_count" CHECK ("recurring_rules"."count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"fire_at" timestamp with time zone,
	"days_before" smallint,
	"time_of_day" time,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_kind" CHECK ("reminders"."kind" in ('absolute', 'relative')),
	CONSTRAINT "reminders_fire_at" CHECK (("reminders"."kind" = 'absolute') = ("reminders"."fire_at" is not null)),
	CONSTRAINT "reminders_days_before" CHECK (("reminders"."kind" = 'relative') = ("reminders"."days_before" is not null) and "reminders"."days_before" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_id_user" UNIQUE("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "important_dates" ADD CONSTRAINT "important_dates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "important_dates" ADD CONSTRAINT "important_dates_record" FOREIGN KEY ("record_id","user_id") REFERENCES "public"."records"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_record" FOREIGN KEY ("record_id","user_id") REFERENCES "public"."records"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_tags" ADD CONSTRAINT "record_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_tags" ADD CONSTRAINT "record_tags_record" FOREIGN KEY ("record_id","user_id") REFERENCES "public"."records"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_tags" ADD CONSTRAINT "record_tags_tag" FOREIGN KEY ("tag_id","user_id") REFERENCES "public"."tags"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_category" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_record" FOREIGN KEY ("record_id","user_id") REFERENCES "public"."records"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_record" FOREIGN KEY ("record_id","user_id") REFERENCES "public"."records"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name" ON "categories" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "occurrences_user_date" ON "occurrences" USING btree ("user_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "record_tags_user_tag" ON "record_tags" USING btree ("user_id","tag_id");--> statement-breakpoint
CREATE INDEX "records_user_type" ON "records" USING btree ("user_id","type") WHERE "records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "records_user_list" ON "records" USING btree ("user_id","is_pinned" DESC NULLS LAST,"updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reminders_user" ON "reminders" USING btree ("user_id") WHERE "reminders"."enabled";--> statement-breakpoint
CREATE INDEX "reminders_record" ON "reminders" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_name" ON "tags" USING btree ("user_id",lower("name"));