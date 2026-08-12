-- Custom SQL migration file, put your code below! --
CREATE OR REPLACE FUNCTION reject_immutable_homework_version_updates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'homework submission versions are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER homework_submissions_immutable_before_update
BEFORE UPDATE ON homework_submissions
FOR EACH ROW
EXECUTE FUNCTION reject_immutable_homework_version_updates();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_immutable_homework_review_updates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'homework rubric review versions are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER homework_rubric_reviews_immutable_before_update
BEFORE UPDATE ON homework_rubric_reviews
FOR EACH ROW
EXECUTE FUNCTION reject_immutable_homework_review_updates();
