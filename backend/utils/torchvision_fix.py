# Torchvision compatibility fix for functional_tensor module
# This file helps resolve compatibility issues between different torchvision versions

### Migrated from thirdparty/Hunyuan3D-2.1/torchvision_fix.py

import logging
import os
import sys

logger = logging.getLogger(__name__)
_TORCHVISION_IMPORT_ERROR = None

try:
    import torchvision
except Exception as error:
    # Some broken native/operator registrations raise RuntimeError or OSError,
    # not ImportError. Keep the compatibility helper importable for diagnosis.
    torchvision = None
    _TORCHVISION_IMPORT_ERROR = error
    logger.warning(
        "TorchVision import failed during compatibility setup (%s): %s",
        type(error).__name__,
        error,
        exc_info=True,
    )



def fix_torchvision_functional_tensor():
    """
    Fix torchvision.transforms.functional_tensor import issue
    """
    try:
        # Check if the module exists in the expected location
        import torchvision.transforms.functional_tensor

        print("torchvision.transforms.functional_tensor is available")
        return True
    except ImportError:
        print(
            "torchvision.transforms.functional_tensor not found, applying compatibility fix..."
        )

        try:
            # Create a mock functional_tensor module with the required functions
            import torch
            import torchvision.transforms.functional as F

            class FunctionalTensorMock:
                """Mock module to replace functional_tensor"""

                @staticmethod
                def rgb_to_grayscale(img, num_output_channels=1):
                    """Convert RGB image to grayscale"""
                    if hasattr(F, "rgb_to_grayscale"):
                        return F.rgb_to_grayscale(img, num_output_channels)
                    else:
                        # Fallback implementation
                        if len(img.shape) == 4:  # Batch of images
                            weights = torch.tensor(
                                [0.299, 0.587, 0.114],
                                device=img.device,
                                dtype=img.dtype,
                            ).view(1, 3, 1, 1)
                        else:  # Single image
                            weights = torch.tensor(
                                [0.299, 0.587, 0.114],
                                device=img.device,
                                dtype=img.dtype,
                            ).view(3, 1, 1)

                        grayscale = torch.sum(img * weights, dim=-3, keepdim=True)

                        if num_output_channels == 3:
                            if len(img.shape) == 4:
                                grayscale = grayscale.repeat(1, 3, 1, 1)
                            else:
                                grayscale = grayscale.repeat(3, 1, 1)

                        return grayscale

                @staticmethod
                def resize(img, size, interpolation=2, antialias=None):
                    """Resize function wrapper"""
                    try:
                        from torchvision.transforms.v2.functional import (
                            resize as v2_resize,
                        )

                        return v2_resize(
                            img, size, interpolation=interpolation, antialias=antialias
                        )
                    except ImportError:
                        if hasattr(F, "resize"):
                            return F.resize(img, size, interpolation=interpolation)
                        else:
                            import torch.nn.functional as torch_F

                            if isinstance(size, int):
                                size = (size, size)
                            return torch_F.interpolate(
                                img.unsqueeze(0) if len(img.shape) == 3 else img,
                                size=size,
                                mode="bilinear",
                                align_corners=False,
                            )

                def __getattr__(self, name):
                    """Fallback to regular functional module"""
                    if hasattr(F, name):
                        return getattr(F, name)
                    else:
                        # Try v2.functional
                        try:
                            import torchvision.transforms.v2.functional as v2_F

                            if hasattr(v2_F, name):
                                return getattr(v2_F, name)
                        except ImportError:
                            pass

                        raise AttributeError(
                            f"'{name}' not found in functional_tensor mock"
                        )

            # Create the mock module instance
            functional_tensor_mock = FunctionalTensorMock()

            # Monkey patch the old location
            sys.modules["torchvision.transforms.functional_tensor"] = (
                functional_tensor_mock
            )
            print("Applied compatibility fix: created functional_tensor mock module")
            return True

        except Exception as e:
            print(f"Failed to create functional_tensor mock: {e}")
            return False


def fix_transformers_cache():
    """
    Ensure transformers exports HybridCache for peft/diffusers compatibility.
    In Transformers v5, HybridCache was refactored/removed while peft and diffusers
    importers expect `from transformers import ..., HybridCache, ...`.
    """
    try:
        import transformers

        cache_utils = getattr(transformers, "cache_utils", None)
        cache_type = (
            getattr(transformers, "DynamicCache", None)
            or getattr(cache_utils, "DynamicCache", None)
            or getattr(transformers, "Cache", None)
            or getattr(cache_utils, "Cache", None)
        )
        if cache_type is None:
            raise ImportError(
                "Transformers exports neither DynamicCache nor Cache; "
                "cannot provide a functional HybridCache import fallback."
            )

        if not hasattr(transformers, "HybridCache"):
            # Alias the real cache implementation rather than inventing a new
            # empty subclass. This preserves its constructor and cache methods;
            # it does not claim HybridCache-specific sliding-window semantics.
            setattr(transformers, "HybridCache", cache_type)
            logger.warning(
                "Transformers HybridCache is unavailable; exposing %s as an "
                "import-compatibility fallback. HybridCache-specific semantics "
                "are not provided by this fallback.",
                getattr(cache_type, "__name__", repr(cache_type)),
            )
        if cache_utils is not None and not hasattr(cache_utils, "HybridCache"):
            setattr(cache_utils, "HybridCache", getattr(transformers, "HybridCache"))

        return True
    except Exception as error:
        logger.warning(
            "Failed to apply Transformers cache compatibility fix (%s): %s",
            type(error).__name__,
            error,
            exc_info=True,
        )
        return False


def fix_torch_load_weights_only():
    """
    Ensure torch.load falls back to weights_only=False in PyTorch 2.6+.
    PyTorch 2.6 flipped the default weights_only to True, which raises UnpicklingError
    on legacy pickled checkpoints used by third-party model weights.
    """
    try:
        import torch
        if hasattr(torch, "load"):
            _orig_load = torch.load
            if getattr(_orig_load, "_weights_only_patched", False):
                return True

            def _compat_torch_load(*args, **kwargs):
                if "weights_only" not in kwargs:
                    try:
                        return _orig_load(*args, **kwargs)
                    except Exception as err:
                        err_str = str(err)
                        if "weights_only" in err_str or "WeightsUnpickler" in err_str or "UnpicklingError" in type(err).__name__:
                            return _orig_load(*args, weights_only=False, **kwargs)
                        raise
                return _orig_load(*args, **kwargs)

            _compat_torch_load._weights_only_patched = True
            torch.load = _compat_torch_load
            print("Applied compatibility fix: patched torch.load fallback for weights_only in PyTorch 2.6+")
        return True
    except Exception as e:
        print(f"Failed to apply torch.load compatibility fix: {e}")
        return False


def load_dotenv_into_environ():
    """
    Ensure variables from .env (such as HF_TOKEN, HUGGINGFACE_TOKEN, etc.)
    are available in os.environ across all scheduler workers and sub-processes.
    """
    try:
        from pathlib import Path
        search_paths = [
            Path(".env"),
            Path("../.env"),
            Path(__file__).resolve().parents[2] / ".env",
            Path(__file__).resolve().parents[1] / ".env",
        ]
        # Also check Kaggle standard locations
        if Path("/kaggle/working/ForMash3D/.env").exists():
            search_paths.insert(0, Path("/kaggle/working/ForMash3D/.env"))
        if Path("/kaggle/working/.env").exists():
            search_paths.insert(0, Path("/kaggle/working/.env"))

        for env_file in search_paths:
            if env_file.is_file():
                with open(env_file, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip('"').strip("'")
                            if k and k not in os.environ and v:
                                os.environ[k] = v
                break
    except Exception:
        pass

    # Ensure HF_TOKEN and HUGGINGFACE_TOKEN aliases stay in sync
    hf_tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if hf_tok:
        os.environ.setdefault("HF_TOKEN", hf_tok)
        os.environ.setdefault("HUGGINGFACE_TOKEN", hf_tok)
    return True


load_dotenv_into_environ()


def fix_huggingface_repo_redirects():
    """
    1. Redirect renamed Hugging Face repositories (e.g., lambdalabs -> lambda).
    2. Gracefully handle Read-Only file systems (e.g. Kaggle datasets /root/.cache):
       - If lock acquisition fails with EROFS (Errno 30), locate the target in existing snapshot caches.
       - If not present in cache, download into a writable fallback cache directory (/kaggle/working/.cache or /tmp).
    """
    try:
        import huggingface_hub.file_download as fd
        _orig_download = getattr(fd, "hf_hub_download", None)
        if _orig_download is not None and not getattr(_orig_download, "_repo_redirect_patched", False):
            def _find_in_readonly_cache(repo_id: str, filename: str):
                import os
                from pathlib import Path
                repo_folder = f"models--{repo_id.replace('/', '--')}"
                search_roots = []
                for p in [
                    os.environ.get("HUGGINGFACE_HUB_CACHE"),
                    os.environ.get("HF_HOME") and os.path.join(os.environ["HF_HOME"], "hub"),
                    str(Path.home() / ".cache" / "huggingface" / "hub"),
                    "/root/.cache/huggingface/hub",
                    "/kaggle/working/.cache/huggingface/hub",
                ]:
                    if p and p not in search_roots:
                        search_roots.append(p)

                if os.path.isdir("/kaggle/input"):
                    try:
                        for entry in os.listdir("/kaggle/input"):
                            candidate_hub = os.path.join("/kaggle/input", entry, "hub")
                            if os.path.isdir(candidate_hub) and candidate_hub not in search_roots:
                                search_roots.append(candidate_hub)
                            candidate_direct = os.path.join("/kaggle/input", entry)
                            if candidate_direct not in search_roots:
                                search_roots.append(candidate_direct)
                    except Exception:
                        pass

                for root in search_roots:
                    candidate_repo = os.path.join(root, repo_folder)
                    snapshots_dir = os.path.join(candidate_repo, "snapshots")
                    if os.path.isdir(snapshots_dir):
                        try:
                            for snap in os.listdir(snapshots_dir):
                                file_path = os.path.join(snapshots_dir, snap, filename)
                                if os.path.isfile(file_path):
                                    return file_path
                        except Exception:
                            pass
                    direct_file = os.path.join(candidate_repo, filename)
                    if os.path.isfile(direct_file):
                        return direct_file
                return None

            def _redirected_hf_hub_download(repo_id, *args, **kwargs):
                if isinstance(repo_id, str):
                    if repo_id.startswith("lambdalabs/"):
                        repo_id = "lambda/" + repo_id[len("lambdalabs/"):]
                    elif repo_id.startswith("/") or repo_id.startswith(".") or "\\" in repo_id or repo_id in ("kaggle", "root", "home"):
                        filename = args[0] if args else kwargs.get("filename")
                        if "TRELLIS" in str(repo_id) or (filename and "ckpts" in str(filename)):
                            repo_id = "microsoft/TRELLIS.2-4B"
                        else:
                            repo_id = "microsoft/TRELLIS.2-4B"

                filename = args[0] if args else kwargs.get("filename")

                try:
                    return _orig_download(repo_id, *args, **kwargs)
                except OSError as e:
                    # Errno 30: Read-only file system (e.g. Kaggle /root/.cache lock acquisition failure)
                    is_rofs = getattr(e, "errno", None) == 30 or "Read-only file system" in str(e)
                    if is_rofs and filename:
                        # 1. Search read-only snapshots first to avoid unnecessary redownloads
                        cached = _find_in_readonly_cache(repo_id, filename)
                        if cached:
                            return cached

                        # 2. Retry download to a writable cache directory
                        from pathlib import Path
                        fallback = "/kaggle/working/.cache/huggingface/hub" if Path("/kaggle/working").is_dir() else "/tmp/huggingface/hub"
                        kwargs_copy = dict(kwargs)
                        kwargs_copy["cache_dir"] = fallback
                        return _orig_download(repo_id, *args, **kwargs_copy)
                    raise

            _redirected_hf_hub_download._repo_redirect_patched = True
            fd.hf_hub_download = _redirected_hf_hub_download
    except Exception:
        pass
    return True


def fix_gated_huggingface_repos():
    """
    Handle gated Hugging Face repositories gracefully.
    - 'briaai/RMBG-2.0' is gated and returns 401 if unapproved. Fallback to 'ZhengPeng7/BiRefNet' or 'briaai/RMBG-1.4'.
    - 'facebook/dinov3-vitl16-pretrain-lvd1689m' is gated. Fallback to 'camenduru/dinov3-vitl16-pretrain-lvd1689m'.
    """
    try:
        import transformers
        if hasattr(transformers, "AutoModelForImageSegmentation"):
            cls = transformers.AutoModelForImageSegmentation
            orig_from_pretrained = getattr(cls, "from_pretrained", None)
            if orig_from_pretrained is not None and not getattr(orig_from_pretrained, "_gated_fallback_patched", False):
                def _patched_from_pretrained(pretrained_model_name_or_path, *args, **kwargs):
                    try:
                        return orig_from_pretrained(pretrained_model_name_or_path, *args, **kwargs)
                    except Exception as e:
                        err_str = str(e)
                        if "gated repo" in err_str.lower() or "restricted" in err_str.lower() or "401" in err_str or "403" in err_str:
                            if pretrained_model_name_or_path == "briaai/RMBG-2.0":
                                for fb in ("ZhengPeng7/BiRefNet", "briaai/RMBG-1.4"):
                                    try:
                                        print(f"Retrying image segmentation with ungated fallback: {fb}")
                                        return orig_from_pretrained(fb, *args, **kwargs)
                                    except Exception:
                                        continue
                        raise

                _patched_from_pretrained._gated_fallback_patched = True
                cls.from_pretrained = classmethod(_patched_from_pretrained)
    except Exception:
        pass
    return True


def fix_numba_caching():
    """
    Disable Numba caching to prevent RuntimeError: cannot cache function ...: no locator available.
    In environments like Kaggle and conda/miniconda where Python libraries are installed
    in system/read-only directories or non-standard paths, numba fails when compiling @jit(cache=True).
    Specifically, rembg imports pymatting.util.kdtree, which decorates _make_tree with @jit(cache=True).
    """
    import os

    # 1. Set environment variables
    os.environ["NUMBA_DISABLE_CACHING"] = "1"
    os.environ.setdefault("NUMBA_CACHE_DIR", "/tmp/numba_cache")
    try:
        os.makedirs(os.environ["NUMBA_CACHE_DIR"], exist_ok=True)
    except Exception:
        pass

    # 2. Update numba runtime config if already imported
    try:
        import numba.config
        numba.config.DISABLE_CACHING = 1
        numba.config.CACHE_DIR = os.environ.get("NUMBA_CACHE_DIR", "/tmp/numba_cache")
    except Exception:
        pass

    # 3. Monkeypatch numba.jit and numba.njit if numba is installed
    try:
        import numba

        def _wrap_jit(orig_func):
            if getattr(orig_func, "_numba_caching_patched", False):
                return orig_func

            import functools

            @functools.wraps(orig_func)
            def _patched_jit(*args, **kwargs):
                # Force cache=False to prevent locator errors in conda/kaggle envs
                if kwargs.get("cache") is True:
                    kwargs["cache"] = False

                try:
                    result = orig_func(*args, **kwargs)
                except RuntimeError as e:
                    if "cannot cache function" in str(e) or "no locator available" in str(e):
                        kwargs["cache"] = False
                        result = orig_func(*args, **kwargs)
                    else:
                        raise

                if callable(result):
                    @functools.wraps(result)
                    def _wrapped_target(fn):
                        try:
                            return result(fn)
                        except RuntimeError as e:
                            if "cannot cache function" in str(e) or "no locator available" in str(e):
                                kwargs["cache"] = False
                                retry_decorator = orig_func(*args, **kwargs)
                                return retry_decorator(fn)
                            raise
                    return _wrapped_target
                return result

            _patched_jit._numba_caching_patched = True
            return _patched_jit

        if hasattr(numba, "jit"):
            numba.jit = _wrap_jit(numba.jit)
        if hasattr(numba, "njit"):
            numba.njit = _wrap_jit(numba.njit)

        # Also patch internal decorator module references if loaded
        for mod_name in ("numba.core.decorators", "numba.decorators"):
            mod = sys.modules.get(mod_name)
            if mod:
                if hasattr(mod, "jit"):
                    mod.jit = _wrap_jit(mod.jit)
                if hasattr(mod, "njit"):
                    mod.njit = _wrap_jit(mod.njit)

        print("Applied compatibility fix: numba caching disabled and @jit/@njit monkeypatched")
        return True
    except ImportError:
        return True
    except Exception as e:
        print(f"Failed to apply numba caching fix: {e}")
        return False


class SafeBackgroundRemoverFallback:
    """Safe fallback background remover when rembg or pymatting fails."""
    def __init__(self, session=None):
        self.session = session

    def __call__(self, image):
        if self.session is not None:
            try:
                import rembg
                return rembg.remove(image, session=self.session, bgcolor=[255, 255, 255, 0])
            except Exception:
                pass
        return image.convert("RGBA") if hasattr(image, "convert") else image


def fix_transformers_dinov3():
    """
    Ensure `DINOv3ViTModel` and `DINOv3ViTConfig` are exportable from `transformers`.
    In older transformers versions (transformers < 4.50), DINOv3 is not included,
    causing TRELLIS.2 and Pixal3D to fail with:
    `cannot import name 'DINOv3ViTModel' from 'transformers'`
    """
    try:
        import transformers
    except ImportError:
        return False

    if hasattr(transformers, "DINOv3ViTModel") and hasattr(transformers, "DINOv3ViTConfig"):
        return True

    # 1. Check if dinov3_vit can be imported from transformers.models
    try:
        from transformers.models.dinov3_vit.modeling_dinov3_vit import DINOv3ViTModel, DINOv3ViTConfig
        setattr(transformers, "DINOv3ViTModel", DINOv3ViTModel)
        setattr(transformers, "DINOv3ViTConfig", DINOv3ViTConfig)
        if "transformers" in sys.modules:
            setattr(sys.modules["transformers"], "DINOv3ViTModel", DINOv3ViTModel)
            setattr(sys.modules["transformers"], "DINOv3ViTConfig", DINOv3ViTConfig)
        return True
    except (ImportError, AttributeError):
        pass

    # 2. Try loading standalone implementation from utils.dinov3_vit
    try:
        try:
            from utils.dinov3_vit import DINOv3ViTModel, DINOv3ViTConfig
        except ImportError:
            from backend.utils.dinov3_vit import DINOv3ViTModel, DINOv3ViTConfig

        setattr(transformers, "DINOv3ViTModel", DINOv3ViTModel)
        setattr(transformers, "DINOv3ViTConfig", DINOv3ViTConfig)
        if "transformers" in sys.modules:
            setattr(sys.modules["transformers"], "DINOv3ViTModel", DINOv3ViTModel)
            setattr(sys.modules["transformers"], "DINOv3ViTConfig", DINOv3ViTConfig)

        # Register with AutoModel if available
        if hasattr(transformers, "AutoModel"):
            try:
                transformers.AutoModel.register(DINOv3ViTConfig, DINOv3ViTModel)
            except Exception:
                pass

        print("Applied compatibility fix: registered standalone DINOv3ViTModel into transformers")
        return True
    except Exception as e:
        print(f"Failed to apply DINOv3 transformers fix: {e}")
        return False


def get_dinov3_model_class():
    """Retrieve DINOv3ViTModel class, applying fix if needed."""
    try:
        import transformers
        if hasattr(transformers, "DINOv3ViTModel"):
            return getattr(transformers, "DINOv3ViTModel")
    except ImportError:
        pass
    fix_transformers_dinov3()
    try:
        import transformers
        if hasattr(transformers, "DINOv3ViTModel"):
            return getattr(transformers, "DINOv3ViTModel")
    except Exception:
        pass
    try:
        from utils.dinov3_vit import DINOv3ViTModel
        return DINOv3ViTModel
    except ImportError:
        from backend.utils.dinov3_vit import DINOv3ViTModel
        return DINOv3ViTModel


def _fix_triton_dtype_itemsize():
    """
    Patch triton.language.dtype to add `itemsize` property missing in Triton 3.x.
    Triton 3.x removed `.itemsize` from `tl.dtype`; the equivalent is `primitive_bitwidth // 8`.
    This patch is evaluated at Python level before JIT compilation, so it fixes the
    `tl.static_assert(D * keys_ptr.dtype.element_ty.itemsize % 4 == 0, ...)` assertion
    in flex_gemm's hashmap kernel.
    """
    try:
        import triton.language as tl
        if hasattr(tl, "dtype") and not hasattr(tl.dtype, "itemsize"):
            tl.dtype.itemsize = property(lambda self: getattr(self, "primitive_bitwidth", 32) // 8)
            logger.debug("Patched triton.language.dtype.itemsize (Triton 3.x compat)")
    except Exception:
        pass


def _fix_triton_str_to_ty():
    """
    Patch triton.language.str_to_ty to handle 'ier_type', 'modifier_type', etc. in Triton 3.x.
    In Triton 3.x, type annotations like `tl.modifier_type` or bare `tl.pointer_type`
    in kernel signatures cause `str_to_ty` to slice off prefixes and look up
    'ier_type' in `tys`, raising `KeyError: 'ier_type'`.
    """
    try:
        import triton.language as tl
        orig_str_to_ty = getattr(tl, "str_to_ty", None)
        if orig_str_to_ty is not None and not getattr(orig_str_to_ty, "_safe_patched", False):
            def safe_str_to_ty(name, *args, **kwargs):
                if isinstance(name, str):
                    cleaned = name.strip()
                    if cleaned in ("ier_type", "modifier_type", "pointer_type") or cleaned.endswith("ier_type"):
                        return getattr(tl, "int32", None) or getattr(tl, "i32", None)
                try:
                    return orig_str_to_ty(name, *args, **kwargs)
                except KeyError as e:
                    err_key = str(e).strip("'\"")
                    if "ier_type" in err_key or "modifier_type" in err_key or "pointer_type" in err_key:
                        return getattr(tl, "int32", None) or getattr(tl, "i32", None)
                    raise

            safe_str_to_ty._safe_patched = True
            tl.str_to_ty = safe_str_to_ty

            import sys
            for mod_name in ("triton.language", "triton.language.core", "triton.compiler.code_generator"):
                mod = sys.modules.get(mod_name)
                if mod and hasattr(mod, "str_to_ty"):
                    setattr(mod, "str_to_ty", safe_str_to_ty)
            logger.debug("Patched triton.language.str_to_ty for Triton 3.x 'ier_type' compat")
    except Exception:
        pass


def _fix_triton_semantic_or():
    """
    Patch triton.language.core.tensor.__or__ and semantic.or_ for Python 3.10 PEP 604 union support.
    In flex_gemm, parameter annotations like `coord_stride_vec: tl.tensor | None` evaluate `__or__(None)`.
    Triton's AST compiler can invoke this unbound `__or__(None)` with 1 argument or bound with 2 arguments.
    Handling `*args` prevents both TypeError and ValueError('_builder argument must be provided').
    """
    try:
        import triton.language as tl
        import triton.language.core as tlc
        for t_cls in (getattr(tl, "tensor", None), getattr(tlc, "tensor", None)):
            if t_cls is not None:
                orig_or = getattr(t_cls, "__or__", None)
                if orig_or is not None and not getattr(orig_or, "_safe_patched", False):
                    def safe_tensor_or(*args, **kwargs):
                        if len(args) == 0:
                            return None
                        if len(args) == 1:
                            return args[0]
                        self_arg, other_arg = args[0], args[1]
                        if other_arg is None or other_arg is type(None):
                            return self_arg
                        try:
                            return orig_or(*args, **kwargs)
                        except Exception:
                            return self_arg

                    safe_tensor_or._safe_patched = True
                    try:
                        t_cls.__or__ = safe_tensor_or
                        t_cls.__ror__ = safe_tensor_or
                    except Exception:
                        pass
    except Exception:
        pass
    try:
        import triton.language.semantic as sem
        orig_sem_or = getattr(sem, "or_", None)
        if orig_sem_or is not None and not getattr(orig_sem_or, "_safe_patched", False):
            def safe_sem_or(*args, **kwargs):
                if len(args) >= 2:
                    a, b = args[0], args[1]
                    if a is None:
                        return b
                    if b is None:
                        return a
                try:
                    return orig_sem_or(*args, **kwargs)
                except Exception:
                    return args[0] if args else None

            safe_sem_or._safe_patched = True
            sem.or_ = safe_sem_or
    except Exception:
        pass


def _patch_flex_gemm_sources():
    """
    Patch syntax incompatibilities directly in installed flex_gemm source files on disk.
    Fixes:
    1. `tl.tensor | None` in neighbor_map.py causing bitwise-OR ValueError in Triton AST visitor.
    2. `.itemsize` attribute removed in Triton 3.x -> `.primitive_bitwidth // 8`.
    """
    try:
        import sys
        import flex_gemm
        flex_gemm_dir = os.path.dirname(flex_gemm.__file__)
        triton_dir = os.path.join(flex_gemm_dir, "kernels", "triton")
        if not os.path.isdir(triton_dir):
            return

        any_patched = False
        for root, _, files in os.walk(triton_dir):
            for file in files:
                if not file.endswith(".py"):
                    continue
                fpath = os.path.join(root, file)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        text = f.read()
                    new_text = text
                    if "tl.tensor | None" in new_text:
                        new_text = new_text.replace("tl.tensor | None", "None")
                    if "tl.tensor|None" in new_text:
                        new_text = new_text.replace("tl.tensor|None", "None")
                    if ".itemsize" in new_text:
                        new_text = new_text.replace(".itemsize", ".primitive_bitwidth // 8")
                    if new_text != text:
                        with open(fpath, "w", encoding="utf-8") as f:
                            f.write(new_text)
                        any_patched = True
                        logger.info("Patched flex_gemm file on disk: %s", fpath)
                except Exception as file_err:
                    logger.debug("Could not patch flex_gemm file %s: %s", fpath, file_err)

        if any_patched:
            # Drop cached modules so Python re-imports the patched versions from disk
            for mod_name in list(sys.modules.keys()):
                if "flex_gemm.kernels.triton" in mod_name:
                    sys.modules.pop(mod_name, None)
    except Exception:
        pass


def _sanitize_flex_gemm_kernel_annotations():
    """
    Sanitize parameter annotations on flex_gemm Triton kernels.
    In Triton 3.x, parameter annotations like `tl.tensor`, `tl.pointer_type`, or `tl.modifier_type`
    cause signature parsing failure (KeyError: 'ier_type').
    Stripping non-constexpr annotations allows Triton JIT to dynamically infer tensor types.
    """
    try:
        import sys
        # Proactively import key kernel modules
        for mod_name in (
            "flex_gemm.kernels.triton.neighbor_cache.neighbor_map",
            "flex_gemm.kernels.triton.hashmap",
            "flex_gemm.kernels.triton.spconv_fwd",
            "flex_gemm.kernels.triton.spconv_bwd",
        ):
            try:
                __import__(mod_name, fromlist=["*"])
            except Exception:
                pass

        visited = set()
        for mod_name, mod in list(sys.modules.items()):
            if not mod_name.startswith("flex_gemm") or mod is None:
                continue
            for attr_name in dir(mod):
                obj = getattr(mod, attr_name, None)
                if obj is None or id(obj) in visited:
                    continue
                visited.add(id(obj))

                fn = getattr(obj, "fn", obj)
                if hasattr(fn, "__annotations__") and isinstance(fn.__annotations__, dict):
                    to_remove = []
                    for param, ann in fn.__annotations__.items():
                        ann_str = str(ann)
                        if "constexpr" not in ann_str:
                            to_remove.append(param)
                    for param in to_remove:
                        del fn.__annotations__[param]
    except Exception:
        pass


def fix_flex_gemm():
    """
    Ensure `flex_gemm.ops.grid_sample` is importable and Triton 3.x compat is applied.
    In environments where flex_gemm is missing or an older wheel lacks ops.grid_sample,
    this registers pure-PyTorch grid_sample_3d fallback shim.
    Also patches:
      1. triton.language.dtype.itemsize (missing in Triton 3.x)
      2. triton.language.str_to_ty ('ier_type' KeyError in Triton 3.x)
      3. triton.language.core.tensor.__or__ (tl.tensor | None ValueError in Python 3.10)
      4. flex_gemm source files on disk (tl.tensor | None -> None, itemsize -> bitwidth // 8)
      5. flex_gemm Triton kernel parameter annotations
    """
    _fix_triton_dtype_itemsize()
    _fix_triton_str_to_ty()
    _fix_triton_semantic_or()
    _patch_flex_gemm_sources()
    _sanitize_flex_gemm_kernel_annotations()
    try:
        from utils.flex_gemm_fallback import install_flex_gemm_shim
        return install_flex_gemm_shim()
    except Exception:
        try:
            from backend.utils.flex_gemm_fallback import install_flex_gemm_shim
            return install_flex_gemm_shim()
        except Exception as e:
            print(f"Failed to apply flex_gemm fix: {e}")
            return False


def get_grid_sample_3d():
    """Retrieve grid_sample_3d, applying fix if needed."""
    try:
        from flex_gemm.ops.grid_sample import grid_sample_3d
        return grid_sample_3d
    except (ImportError, ModuleNotFoundError, AttributeError):
        pass
    fix_flex_gemm()
    try:
        from flex_gemm.ops.grid_sample import grid_sample_3d
        return grid_sample_3d
    except Exception:
        try:
            from utils.flex_gemm_fallback import grid_sample_3d
            return grid_sample_3d
        except ImportError:
            from backend.utils.flex_gemm_fallback import grid_sample_3d
            return grid_sample_3d


def fix_flash_attention_hardware():
    """
    Ensure attention backends gracefully fall back to PyTorch SDPA on pre-Ampere GPUs (Turing/Volta/Pascal, e.g. T4/V100).
    FlashAttention strictly requires compute capability >= 8.0 (Ampere+).
    If compute capability < 8.0 or flash_attn is unavailable/incompatible, set ATTN_BACKEND='sdpa'.
    """
    import os
    try:
        import torch
        if torch.cuda.is_available():
            min_major = 99
            for i in range(torch.cuda.device_count()):
                try:
                    cap = torch.cuda.get_device_capability(i)
                    if cap[0] < min_major:
                        min_major = cap[0]
                except Exception:
                    pass
            if min_major < 8:
                # Pre-Ampere GPU detected (e.g. Tesla T4 is 7.5, V100 is 7.0)
                # FlashAttention will crash with "FlashAttention only supports Ampere GPUs or newer"
                if os.environ.get("ATTN_BACKEND") in (None, "", "flash_attn", "flash_attn_3", "flash_attn_4"):
                    os.environ["ATTN_BACKEND"] = "sdpa"
                if os.environ.get("SPARSE_ATTN_BACKEND") in (None, "", "flash_attn"):
                    os.environ["SPARSE_ATTN_BACKEND"] = "sdpa"
                print(f"Pre-Ampere GPU detected (compute capability < 8.0). Defaulted ATTN_BACKEND and SPARSE_ATTN_BACKEND to 'sdpa'.")
    except Exception:
        pass
    return True


def fix_pixal3d_modules():
    """
    Ensure DinoV3ProjFeatureExtractor is importable from pixal3d.modules.image_feature_extractor.
    """
    try:
        import pixal3d.modules.image_feature_extractor as ife
        if not hasattr(ife, "DinoV3ProjFeatureExtractor"):
            try:
                from pixal3d.trainers.flow_matching.mixins.image_conditioned_proj import DinoV3ProjFeatureExtractor
                setattr(ife, "DinoV3ProjFeatureExtractor", DinoV3ProjFeatureExtractor)
            except Exception:
                pass
    except Exception:
        pass
    return True


def fix_torch_cluster():
    """
    Ensure torch_cluster.fps is importable for UniRig.
    If torch_cluster is not installed (e.g. Kaggle/minimal CUDA env),
    installs a pure-PyTorch Farthest Point Sampling fallback into sys.modules.
    """
    try:
        import torch_cluster
        if hasattr(torch_cluster, "fps"):
            return True
    except ImportError:
        pass

    import types
    import random
    import math
    from typing import Optional
    import torch

    def fps_fallback(
        src: torch.Tensor,
        batch: Optional[torch.Tensor] = None,
        ratio: Optional[float] = None,
        random_start: bool = True,
    ) -> torch.Tensor:
        """Pure PyTorch fallback for torch_cluster.fps."""
        if ratio is None:
            ratio = 0.5

        if batch is None:
            batch = torch.zeros(src.size(0), dtype=torch.long, device=src.device)

        batch_size = int(batch.max().item()) + 1 if batch.numel() > 0 else 1
        selected = []

        for b in range(batch_size):
            mask = (batch == b)
            batch_indices = mask.nonzero(as_tuple=False).view(-1)
            num_points = batch_indices.numel()
            if num_points == 0:
                continue

            num_samples = max(1, int(math.ceil(num_points * ratio))) if isinstance(ratio, float) else int(ratio)
            num_samples = min(num_samples, num_points)

            pts = src[batch_indices]

            sampled_idx = torch.zeros(num_samples, dtype=torch.long, device=src.device)
            start = random.randint(0, num_points - 1) if random_start else 0
            sampled_idx[0] = start

            cur = pts[start : start + 1]
            dists = torch.sum((pts - cur) ** 2, dim=-1)

            for i in range(1, num_samples):
                far = torch.argmax(dists)
                sampled_idx[i] = far
                new_p = pts[far : far + 1]
                dists = torch.minimum(dists, torch.sum((pts - new_p) ** 2, dim=-1))

            selected.append(batch_indices[sampled_idx])

        if selected:
            return torch.cat(selected, dim=0)
        return torch.empty(0, dtype=torch.long, device=src.device)

    mod = types.ModuleType("torch_cluster")
    mod.fps = fps_fallback
    sys.modules["torch_cluster"] = mod
    return True


def fix_trellis2_sparse_vae_dtype():
    """Ensure TRELLIS.2 SparseStructureDecoder/Encoder align input tensor dtype with conv3d weights (prevents BFloat16/Float32 mismatch)."""
    try:
        from trellis2.models.sparse_structure_vae import SparseStructureDecoder, SparseStructureEncoder

        orig_decoder_forward = SparseStructureDecoder.forward
        if not getattr(orig_decoder_forward, "_dtype_aligned", False):
            def patched_decoder_forward(self, x: torch.Tensor) -> torch.Tensor:
                in_dtype = next(self.input_layer.parameters()).dtype if hasattr(self.input_layer, "parameters") else self.dtype
                if x.dtype != in_dtype:
                    x = x.to(in_dtype)
                h = self.input_layer(x)
                h = h.type(self.dtype)
                h = self.middle_block(h)
                for block in self.blocks:
                    h = block(h)
                out_dtype = next(self.out_layer.parameters()).dtype if hasattr(self.out_layer, "parameters") else self.dtype
                h = h.type(out_dtype)
                h = self.out_layer(h)
                return h

            patched_decoder_forward._dtype_aligned = True
            SparseStructureDecoder.forward = patched_decoder_forward

        orig_encoder_forward = SparseStructureEncoder.forward
        if not getattr(orig_encoder_forward, "_dtype_aligned", False):
            def patched_encoder_forward(self, x: torch.Tensor, sample_posterior: bool = False, return_raw: bool = False) -> torch.Tensor:
                in_dtype = next(self.input_layer.parameters()).dtype if hasattr(self.input_layer, "parameters") else self.dtype
                if x.dtype != in_dtype:
                    x = x.to(in_dtype)
                h = self.input_layer(x)
                h = h.type(self.dtype)
                for block in self.blocks:
                    h = block(h)
                h = self.middle_block(h)
                out_dtype = next(self.out_layer.parameters()).dtype if hasattr(self.out_layer, "parameters") else self.dtype
                h = h.type(out_dtype)
                h = self.out_layer(h)
                mean, logvar = h.chunk(2, dim=1)
                if sample_posterior:
                    std = torch.exp(0.5 * logvar)
                    z = mean + std * torch.randn_like(std)
                else:
                    z = mean
                if return_raw:
                    return z, mean, logvar
                return z

            patched_encoder_forward._dtype_aligned = True
            SparseStructureEncoder.forward = patched_encoder_forward

        try:
            from trellis2.modules.sparse.basic import SparseTensor
            if not getattr(SparseTensor, "_empty_coords_patched", False):
                def patched_cal_shape(self, feats, coords):
                    shape = []
                    if coords.shape[0] == 0:
                        shape.append(0)
                    else:
                        shape.append(coords[:, 0].max().item() + 1)
                    shape.extend([*feats.shape[1:]])
                    return torch.Size(shape)
                def patched_cal_layout(self, coords, batch_size):
                    if coords.shape[0] == 0:
                        return [slice(0, 0) for _ in range(batch_size)]
                    seq_len = torch.bincount(coords[:, 0], minlength=batch_size)
                    offset = torch.cumsum(seq_len, dim=0)
                    layout = [slice((offset[i] - seq_len[i]).item(), offset[i].item()) for i in range(batch_size)]
                    return layout
                def patched_cal_spatial_shape(self, coords):
                    if coords.shape[0] == 0:
                        return torch.Size([0, 0, 0])
                    return torch.Size((coords[:, 1:].max(0)[0] + 1).tolist())

                setattr(SparseTensor, "_SparseTensor__cal_shape", patched_cal_shape)
                setattr(SparseTensor, "_SparseTensor__cal_layout", patched_cal_layout)
                setattr(SparseTensor, "_SparseTensor__cal_spatial_shape", patched_cal_spatial_shape)
                SparseTensor._empty_coords_patched = True
        except Exception:
            pass

        return True
    except Exception as e:
        logger.debug(f"fix_trellis2_sparse_vae_dtype notice: {e}")
        return False


def apply_fix():
    """Apply compatibility fixes (torchvision, transformers, torch.load, hf redirects, numba, dinov3, flex_gemm, flash_attn, and torch_cluster)."""
    load_dotenv_into_environ()
    if torchvision is not None:
        try:
            print(f"Torchvision version: {torchvision.__version__}")
        except Exception:
            pass
        fix_torchvision_functional_tensor()
    fix_transformers_cache()
    fix_transformers_dinov3()
    fix_flex_gemm()
    fix_torch_load_weights_only()
    fix_huggingface_repo_redirects()
    fix_gated_huggingface_repos()
    fix_numba_caching()
    fix_flash_attention_hardware()
    fix_pixal3d_modules()
    fix_torch_cluster()
    fix_trellis2_sparse_vae_dtype()
    return True


if __name__ == "__main__":
    apply_fix()


