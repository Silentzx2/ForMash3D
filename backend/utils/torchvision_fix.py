# Torchvision compatibility fix for functional_tensor module
# This file helps resolve compatibility issues between different torchvision versions

### Migrated from thirdparty/Hunyuan3D-2.1/torchvision_fix.py

import sys

try:
    import torchvision
except ImportError:
    torchvision = None



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
        if not hasattr(transformers, "HybridCache"):
            cache_base = getattr(transformers, "DynamicCache", getattr(transformers, "Cache", object))
            class HybridCache(cache_base):
                """Compatibility fallback for HybridCache in Transformers v5."""
                pass

            setattr(transformers, "HybridCache", HybridCache)
            if hasattr(transformers, "cache_utils") and not hasattr(transformers.cache_utils, "HybridCache"):
                setattr(transformers.cache_utils, "HybridCache", HybridCache)
            print("Applied compatibility fix: created transformers.HybridCache shim")
        return True
    except ImportError:
        return False
    except Exception as e:
        print(f"Failed to apply transformers cache fix: {e}")
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


def fix_huggingface_repo_redirects():
    """
    Redirect renamed Hugging Face repositories (e.g., lambdalabs -> lambda).
    Lambda Labs renamed their org on Hugging Face, causing legacy checkpoints to 404.
    """
    try:
        import huggingface_hub.file_download as fd
        _orig_download = getattr(fd, "hf_hub_download", None)
        if _orig_download is not None and not getattr(_orig_download, "_repo_redirect_patched", False):
            def _redirected_hf_hub_download(repo_id, *args, **kwargs):
                if isinstance(repo_id, str) and repo_id.startswith("lambdalabs/"):
                    repo_id = "lambda/" + repo_id[len("lambdalabs/"):]
                return _orig_download(repo_id, *args, **kwargs)

            _redirected_hf_hub_download._repo_redirect_patched = True
            fd.hf_hub_download = _redirected_hf_hub_download
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


def apply_fix():
    """Apply the compatibility fixes (torchvision, transformers, torch.load, hf redirects, and numba)."""
    if torchvision is not None:
        try:
            print(f"Torchvision version: {torchvision.__version__}")
        except Exception:
            pass
        fix_torchvision_functional_tensor()
    fix_transformers_cache()
    fix_torch_load_weights_only()
    fix_huggingface_repo_redirects()
    fix_numba_caching()
    return True


if __name__ == "__main__":
    apply_fix()

