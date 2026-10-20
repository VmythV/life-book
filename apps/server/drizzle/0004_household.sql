CREATE TABLE "household_items" (
	"record_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT 0 NOT NULL,
	"low_stock_threshold" numeric(12, 3),
	"location" text,
	"low_stock_since" timestamp with time zone,
	"low_stock_notified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_items_quantity" CHECK ("household_items"."quantity" >= 0),
	CONSTRAINT "household_items_threshold" CHECK ("household_items"."low_stock_threshold" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"delta" numeric(12, 3) NOT NULL,
	"quantity_after" numeric(12, 3) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"corrects_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transactions_kind" CHECK ("stock_transactions"."kind" in ('opening', 'purchase', 'consume', 'adjust', 'discard', 'lost')),
	CONSTRAINT "stock_transactions_quantity_after" CHECK ("stock_transactions"."quantity_after" >= 0)
);
--> statement-breakpoint
ALTER TABLE "household_items" ADD CONSTRAINT "household_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_items" ADD CONSTRAINT "household_items_record" FOREIGN KEY ("record_id","user_id") REFERENCES "public"."records"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_corrects_id_stock_transactions_id_fk" FOREIGN KEY ("corrects_id") REFERENCES "public"."stock_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transactions" ADD CONSTRAINT "stock_transactions_record" FOREIGN KEY ("record_id","user_id") REFERENCES "public"."records"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_transactions_item" ON "stock_transactions" USING btree ("user_id","record_id","created_at");