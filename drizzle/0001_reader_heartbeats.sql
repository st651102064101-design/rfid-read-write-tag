CREATE TABLE `reader_heartbeats` (
	`reader_key` text PRIMARY KEY NOT NULL,
	`received_at` text NOT NULL,
	`previous_at` text,
	`payload` text NOT NULL
);
