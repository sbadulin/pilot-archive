"""Fills template.html with candidates.json into nick-review.html."""
import os
from pathlib import Path
C = str(Path(os.environ.get('PILOT_ARCHIVE_ROOT', Path.home() / 'Downloads/Reading')) / 'pilot-archive-fulltext-cache') + '/'
W = C + 'nick-review/'  # working files: candidates, hints, exported answers, the built page
os.makedirs(W, exist_ok=True)
from pathlib import Path
here = Path(__file__).parent
data = Path(W + 'candidates.json').read_text().replace('</', '<\\/')
Path(W + 'nick-review.html').write_text((here / 'template.html').read_text().replace('__DATA__', data))
print('built', W + 'nick-review.html')
