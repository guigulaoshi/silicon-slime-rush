from tools import size_report


def test_hard_max_reports_a_failure_and_discussion_fallback(capsys, monkeypatch):
    monkeypatch.setitem(size_report.LIMITS, "web_total_mb", 10)
    assert size_report.hard_max("web_total_mb", 11, "build") is False
    output = capsys.readouterr().out
    assert "HARD LIMIT: web_total_mb 11 > 10" in output
    assert "raise the limit" in output


def test_hard_max_is_quiet_at_the_line(capsys, monkeypatch):
    monkeypatch.setitem(size_report.LIMITS, "web_total_mb", 10)
    assert size_report.hard_max("web_total_mb", 10, "build") is True
    assert capsys.readouterr().out == ""


def test_main_fails_when_a_raised_hard_line_is_crossed(tmp_path, capsys, monkeypatch):
    dist = tmp_path / "game" / "dist"
    dist.mkdir(parents=True)
    (dist / "game.bin").write_bytes(b"large enough")
    monkeypatch.setattr(size_report, "ROOT", str(tmp_path))
    monkeypatch.setitem(size_report.LIMITS, "web_total_mb", 0)
    monkeypatch.setitem(size_report.LIMITS, "shipping_files", 10)
    monkeypatch.setitem(size_report.LIMITS, "single_file_mb", 100)
    monkeypatch.setitem(size_report.LIMITS, "path_length_chars", 100)

    assert size_report.main() == 1
    output = capsys.readouterr().out
    assert "HARD LIMIT: web_total_mb" in output
    assert "HARD LIMIT EXCEEDED" in output


def test_shipping_extremes_measure_extracted_files(tmp_path):
    nested = tmp_path / "long" / "path"
    nested.mkdir(parents=True)
    (nested / "asset.bin").write_bytes(b"12345")
    largest, longest = size_report.shipping_extremes(str(tmp_path))
    assert largest == 0.000005
    assert longest == len("long/path/asset.bin")
