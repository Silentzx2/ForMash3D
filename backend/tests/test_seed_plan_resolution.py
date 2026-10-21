"""Regression tests for the effective seed plan.

The planner's ``num_seeds`` is a plan value: it is only executed when
``apply.auto_seeds`` is enabled, and the user's candidate count always wins.
The runtime log must report the candidates and seeds that actually run, so the
planner plan and the execution cannot disagree.
"""
from __future__ import annotations

import unittest

from core.planner import resolve_seed_plan

SEEDS_CFG = {"base_seed": 42891, "seed_step": 1337, "max_candidates": 4}


class TestResolveSeedPlan(unittest.TestCase):
    def test_single_candidate_ignores_planned_seeds_when_auto_seeds_disabled(self):
        plan = resolve_seed_plan(
            {"candidate_count": 1, "plan": {"num_seeds": 3}},
            {"seed": 42891},
            seeds_cfg=SEEDS_CFG,
            apply_cfg={"auto_seeds": False},
        )
        self.assertEqual(plan["candidate_count"], 1)
        self.assertEqual(plan["planned_candidate_count"], 3)
        self.assertEqual(plan["seed_schedule"], [42891])
        self.assertFalse(plan["auto_candidates"])

    def test_planned_seeds_run_when_auto_seeds_enabled(self):
        plan = resolve_seed_plan(
            {"candidate_count": 1, "plan": {"num_seeds": 3}},
            {"seed": 42891},
            seeds_cfg=SEEDS_CFG,
            apply_cfg={"auto_seeds": True},
        )
        self.assertEqual(plan["candidate_count"], 3)
        self.assertEqual(plan["seed_schedule"], [42891, 44228, 45565])
        self.assertTrue(plan["auto_candidates"])

    def test_user_candidate_count_wins_over_auto_seeds(self):
        plan = resolve_seed_plan(
            {"candidate_count": 2, "plan": {"num_seeds": 3}},
            {"seed": 42891},
            seeds_cfg=SEEDS_CFG,
            apply_cfg={"auto_seeds": True},
        )
        self.assertEqual(plan["candidate_count"], 2)
        self.assertEqual(plan["seed_schedule"], [42891, 44228])
        self.assertFalse(plan["auto_candidates"])

    def test_candidate_count_is_capped_by_max_candidates(self):
        plan = resolve_seed_plan(
            {"candidate_count": 9, "plan": {"num_seeds": 3}},
            {"seed": 42891},
            seeds_cfg=SEEDS_CFG,
            apply_cfg={"auto_seeds": True},
        )
        self.assertEqual(plan["candidate_count"], 4)

    def test_user_seed_is_the_base_seed(self):
        plan = resolve_seed_plan(
            {"candidate_count": 3, "plan": {"num_seeds": 3}},
            {"seed": 7},
            seeds_cfg=SEEDS_CFG,
            apply_cfg={"auto_seeds": False},
        )
        self.assertEqual(plan["base_seed"], 7)
        self.assertEqual(plan["seed_schedule"], [7, 1344, 2681])

    def test_missing_seed_falls_back_to_the_configured_base_seed(self):
        plan = resolve_seed_plan(
            {"candidate_count": 1},
            {},
            seeds_cfg=SEEDS_CFG,
            apply_cfg={"auto_seeds": False},
        )
        self.assertEqual(plan["base_seed"], 42891)
        self.assertEqual(plan["seed_schedule"], [42891])

    def test_default_apply_config_keeps_auto_seeds_disabled(self):
        plan = resolve_seed_plan(
            {"candidate_count": 1, "plan": {"num_seeds": 3}},
            {"seed": 42891},
            seeds_cfg=SEEDS_CFG,
        )
        self.assertFalse(plan["auto_seeds_enabled"])
        self.assertEqual(plan["candidate_count"], 1)


if __name__ == "__main__":
    unittest.main()
