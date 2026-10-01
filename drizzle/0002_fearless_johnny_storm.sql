CREATE TABLE `writer_bridge` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_seen` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `writer_commands` (
	`request_id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`result` text
);
