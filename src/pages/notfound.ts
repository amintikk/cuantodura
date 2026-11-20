import { boot } from '../site/site.ts';
import { mountSearch } from '../ui/search.ts';
boot();
mountSearch(document.getElementById('nf-search')!, { big: true });
