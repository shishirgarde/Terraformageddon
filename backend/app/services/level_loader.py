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

    required_attrs = condition.get("required_attributes", {})
    expected_filename = required_attrs.get("filename")
    expected_content = required_attrs.get("content")

    if not expected_filename or not expected_content:
        return False

    # Check the actual file on disk — most reliable for local_file resources
    actual_file = workspace_path / expected_filename
    if not actual_file.exists():
        return False

    actual_content = actual_file.read_text()
    return actual_content.strip() == expected_content.strip()
