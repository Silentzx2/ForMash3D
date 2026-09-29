        lod_path.write_bytes(_export_glb(level["mesh"]))
        lods[idx] = str(lod_path)

    physics_enabled = bool(
        job_metadata.get("physics_enabled", job_inputs.get("physics_enabled", False))
    )
    physics_config = normalize_physics_config(
        job_metadata.get("physics_config") or job_inputs.get("physics_config")
    )

    # Collision is part of the normal post-processing contract. Physics ON adds
    # physics metadata/readiness and lets the user choose the collision budget.
    collision_quality = physics_config["collision_quality"] if physics_enabled else "fast"
    collision_options = collision_options_for_quality(collision_quality)
    if not physics_enabled:
        collision_options = {
            "method": "convex_hull",
            "max_hulls": 16,
            "max_hull_vertices": 64,
            "input_faces": 1000,
            "resolution": 1000,
            "seed": 0,
        }

    _emit(progress, 0.88, "collision", "Generating collision proxy.")
    collision_path: Optional[Path] = None
    physics_metadata: Optional[Dict[str, Any]] = None
    try:
        collision_scene, collision_stats = run_collision(
            uv_mesh,
            CollisionOptions(**collision_options),
        )
        collision_payload = collision_scene.export(file_type="glb")
        if isinstance(collision_payload, str):
            collision_payload = collision_payload.encode("utf-8")
        collision_path = collision_dir / "collision.glb"
        collision_path.write_bytes(collision_payload)

        if physics_enabled:
            physics_metadata = build_physics_metadata(
                uv_mesh, physics_config, collision_stats
            )
            _write_json(metadata_dir / "physics.json", physics_metadata)
    except Exception as exc:
        logger.error("Collision generation failed for %s: %s", job_id, exc, exc_info=True)
        raise RuntimeError(f"Collision generation failed: {exc}") from exc

    _emit(progress, 0.93, "preview", "Generating asset preview.")
    thumbnail_path: Optional[Path] = None
    try:
        from .services.mesh_thumbnail import render_mesh_thumbnail
        thumbnail_path = preview_dir / "thumbnail.png"
        thumbnail_bytes = render_mesh_thumbnail(glb_path.read_bytes())
        thumbnail_path.write_bytes(thumbnail_bytes)
        with Image.open(thumbnail_path) as preview:
            preview.convert("RGB").save(preview_dir / "preview.jpg", "JPEG", quality=92)
    except Exception as exc:
        logger.warning("Preview generation skipped: %s", exc)

    _emit(progress, 0.96, "qa", "Running final game-ready inspection.")
    try:
        final_scene = trimesh.load(glb_path, file_type="glb", process=False)
        if not isinstance(final_scene, trimesh.Scene):
            final_scene = trimesh.Scene(uv_mesh)
        qa_report = run_inspect(
            final_scene,
            uv_mesh,
            InspectOptions(
                tri_budget=50_000,
                texture_resolution=2048,
                max_material_count=8,
                uv_overlap_grid=512,