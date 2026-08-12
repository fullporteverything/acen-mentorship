ALTER TABLE "homework_submissions" ADD CONSTRAINT "homework_submissions_id_member_unique" UNIQUE("id","member_id");
--> statement-breakpoint
ALTER TABLE "homework_rubric_reviews" ADD CONSTRAINT "homework_rubric_reviews_submission_member_owner_fk" FOREIGN KEY ("submission_id","member_id") REFERENCES "public"."homework_submissions"("id","member_id") ON DELETE no action ON UPDATE no action;
