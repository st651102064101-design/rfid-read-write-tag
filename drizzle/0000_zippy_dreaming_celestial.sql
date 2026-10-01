CREATE TABLE `reader_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`received_at` text NOT NULL,
	`payload` text NOT NULL
);
