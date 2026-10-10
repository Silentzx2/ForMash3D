import re

with open("backend/api/routers/multiview.py", "r") as f:
    content = f.read()

replacement = """class MultiViewReconstruct3DRequest(BaseModel):
    \"\"\"Request contract for Multi-View -> 3D reconstruction.\"\"\"

    asset_id: Optional[str] = Field(None, description="Existing Multi-View asset ID")
    images: Optional[List[Dict[str, Any]]] = Field(None, description="Explicit view images with file_id and view")
    model_preference: str = Field(..., description="Target 3D reconstruction model ID")
    output_format: str = Field("glb", description="Desired mesh output format")
    topology_mode: Optional[str] = Field("triangle", description="Topology mode: 'triangle' or 'quad'")
    quad_topology: bool = Field(False, description="Request quad-dominant topology")
    physics_enabled: bool = Field(False, description="Request physics-ready post-processing")
    model_parameters: Optional[Dict[str, Any]] = None
    target_polycount: Optional[int] = None
    quality: Optional[str] = "high"
    generateLOD: bool = True
    lodPreset: str = "high"
    lodCount: int = 4
    texture_resolution: Optional[int] = 2048
    intent: Optional[str] = None
    preprocessing_artifact_id: Optional[str] = None
    enhancement_enabled: bool = False
"""
content = re.sub(r'class MultiViewReconstruct3DRequest\(BaseModel\):.*?physics_enabled: bool = Field\(False, description="Request physics-ready post-processing"\)\n', replacement, content, flags=re.DOTALL)

with open("backend/api/routers/multiview.py", "w") as f:
    f.write(content)
