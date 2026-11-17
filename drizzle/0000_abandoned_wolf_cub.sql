CREATE TABLE `carry_worlds_v2` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carry_worlds_v2_code_unique` ON `carry_worlds_v2` (`code`);