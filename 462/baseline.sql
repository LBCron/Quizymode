SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
BEGIN READ ONLY;
WITH h AS (
  SELECT * FROM "AnalyticsEvents"
  WHERE "ContextType"='home' AND "ContextId"='8f9b8c14-8d30-4d94-9b20-4c7bb7f7f511'
    AND NOT "IsBot" AND NOT "IsInternal" AND "OccurredUtc" > now() - interval '28 days')
SELECT
  count(DISTINCT "RunId") FILTER (WHERE "EventName"='quick_quiz_started') AS started_runs,
  count(DISTINCT "RunId") FILTER (WHERE "EventName"='quiz_completed') AS completed_runs,
  count(DISTINCT "SessionId") FILTER (WHERE "EventName"='quiz_completed') AS completer_sessions
FROM h;
WITH c AS (
  SELECT "SessionId", min("OccurredUtc") t FROM "AnalyticsEvents"
  WHERE "ContextType"='home' AND "ContextId"='8f9b8c14-8d30-4d94-9b20-4c7bb7f7f511' AND "EventName"='quiz_completed'
    AND NOT "IsBot" AND NOT "IsInternal" AND "OccurredUtc" > now() - interval '28 days'
  GROUP BY "SessionId")
SELECT count(*) AS completers,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "AnalyticsEvents" e WHERE e."SessionId"=c."SessionId" AND e."EventName"='quick_quiz_started' AND e."OccurredUtc">c.t AND NOT e."IsBot")) AS with_second_activity
FROM c;
SELECT "EventName", count(*) FROM "AnalyticsEvents" WHERE NOT "IsBot" AND NOT "IsInternal" AND "OccurredUtc" > now() - interval '28 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 12;
ROLLBACK;
