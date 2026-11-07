from datetime import datetime, timedelta, timezone

import pytest

from app.services.publishing_service import build_schedule_times


def test_build_schedule_times_applies_interval_in_utc():
    start = datetime(2026, 11, 8, 9, 0, tzinfo=timezone(timedelta(hours=7)))
    result = build_schedule_times(start, 3, 45)
    assert result[0] == datetime(2026, 11, 8, 2, 0, tzinfo=timezone.utc)
    assert result[1] - result[0] == timedelta(minutes=45)
    assert result[2] - result[1] == timedelta(minutes=45)


def test_build_schedule_times_rejects_naive_datetime():
    with pytest.raises(ValueError, match="múi giờ"):
        build_schedule_times(datetime(2026, 11, 8, 9, 0), 1, 30)


@pytest.mark.parametrize("interval", [0, -1, 10081])
def test_build_schedule_times_rejects_invalid_interval(interval):
    with pytest.raises(ValueError, match="khoảng cách"):
        build_schedule_times(datetime.now(timezone.utc), 2, interval)


def test_build_schedule_times_rejects_empty_video_batch():
    with pytest.raises(ValueError, match="ít nhất"):
        build_schedule_times(datetime.now(timezone.utc), 0, 30)
