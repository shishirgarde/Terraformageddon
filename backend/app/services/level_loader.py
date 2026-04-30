import json
from pathlib import Path
import yaml

LEVELS_DIR = Path(__file__).parent.parent.parent / "levels"


def get_level_config(level_id: str) -> dict:
    config_path = LEVELS_DIR / level_id / "config.yaml"
    if not config_path.exists():
        raise ValueError(f"Level '{level_id}' not found")
    with open(config_path) as f:
        return yaml.safe_load(f)


def get_starter_code(level_id: str) -> str:
    template_path = LEVELS_DIR / level_id / "main.tf.template"
    if not template_path.exists():
        return ""
    return template_path.read_text()


def get_workspace_seed_files(level_id: str) -> dict[str, str]:
    """Returns {filename: content} for files to pre-seed into the workspace."""
    config = get_level_config(level_id)
    seed_files = {}
    workspace_dir = LEVELS_DIR / level_id / "workspace"
    for filename in config.get("workspace_seed_files", []):
        file_path = workspace_dir / filename
        if file_path.exists():
            seed_files[filename] = file_path.read_text()
    return seed_files


def check_success_condition(workspace_path: Path, level_id: str) -> bool:
    config = get_level_config(level_id)
    condition = config.get("success_condition", {})

    if condition.get("type") != "resource_exists":
        return False

    state_file = workspace_path / "terraform.tfstate"
    if not state_file.exists():
        return False

    try:
        state = json.loads(state_file.read_text())
    except (json.JSONDecodeError, OSError):
        return False

    addr = condition["resource_address"]
    rtype, rname = addr.split(".", 1)
    required_attrs = condition.get("required_attributes", {})

    for resource in state.get("resources", []):
        if resource.get("type") == rtype and resource.get("name") == rname:
            for instance in resource.get("instances", []):
                attrs = instance.get("attributes", {})
                if all(attrs.get(k) == v for k, v in required_attrs.items()):
                    return True
    return False
