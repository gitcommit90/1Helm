-- Removes the tables of the deleted classic router, decision shadow and router lab (every model call is set on the Models page, and no experiment,
-- shadow or lab is kept). Only Cloud (EE) code on a development deployment ever wrote them, so a self-hosted deployment is not affected.
DROP TABLE IF EXISTS router_pool;
DROP TABLE IF EXISTS router_shadow;
DROP TABLE IF EXISTS decision_shadow;
DROP TABLE IF EXISTS router_lab_catalog;
DROP TABLE IF EXISTS router_lab_pools;
DROP TABLE IF EXISTS router_lab_pool_versions;
DROP TABLE IF EXISTS router_lab_runs;
DROP TABLE IF EXISTS router_lab_incumbents;
