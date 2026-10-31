import json, numpy as np
from scipy import stats
from scipy.optimize import curve_fit
import statsmodels.api as sm
from statsmodels.formula.api import ols
import pandas as pd
out = {}
a = [34.2, 39.1, 28.4, 41.0, 36.5, 30.2, 37.8, 33.3]
b = [45.1, 41.9, 50.2, 39.8, 47.7, 44.0, 52.3]
c = [40.2, 38.8, 43.1, 36.9, 41.5, 44.7, 39.9, 42.0]
out['dist'] = {
 'tcdf': [stats.t.cdf(x, df) for x, df in [(1.5, 3), (-2.2, 10), (0.3, 1), (4.0, 50)]],
 'tinv': [stats.t.ppf(p, df) for p, df in [(0.975, 3), (0.995, 10), (0.9, 1), (0.975, 120)]],
 'fsf': [stats.f.sf(x, d1, d2) for x, d1, d2 in [(3.2, 2, 20), (1.1, 5, 7), (10, 1, 3)]],
 'chi2sf': [stats.chi2.sf(x, k) for x, k in [(3.84, 1), (10, 4), (0.5, 3)]],
 'chi2inv': [stats.chi2.ppf(p, k) for p, k in [(0.95, 1), (0.5, 4), (0.999, 10)]],
 'norminv': [stats.norm.ppf(p) for p in [0.001, 0.025, 0.4, 0.975, 0.999999]],
 'ptukey': [stats.studentized_range.cdf(q, k, df) for q, k, df in [(3.5, 3, 12), (2.0, 4, 20), (4.5, 5, 30), (3.0, 2, 8)]],
 'qtukey': [stats.studentized_range.ppf(0.95, k, df) for k, df in [(3, 12), (4, 20), (6, 40)]],
}
out['ttest'] = {
 'student': list(stats.ttest_ind(a, b)), 'welch': list(stats.ttest_ind(a, b, equal_var=False)),
 'paired': list(stats.ttest_rel(a[:7], b)), 'one': list(stats.ttest_1samp(a, 30)),
}
out['mw'] = stats.mannwhitneyu(a, b, method='exact').pvalue
out['wilcoxon'] = stats.wilcoxon(np.array(b) - np.array(a[:7]), method='exact').pvalue
out['shapiro'] = list(stats.shapiro(a + c))
out['dagostino'] = list(stats.normaltest(a + c + b))
out['pearson'] = list(stats.pearsonr(a[:7], b))
out['spearman'] = list(stats.spearmanr(a[:7], b))
out['anova'] = list(stats.f_oneway(a, b, c))
tk = stats.tukey_hsd(a, b, c)
out['tukey'] = [tk.pvalue[0][1], tk.pvalue[0][2], tk.pvalue[1][2]]
dn = stats.dunnett(b, c, control=a)
out['dunnett'] = list(dn.pvalue)
out['kruskal'] = list(stats.kruskal(a, b, c))
m = np.array([a[:7], b, c[:7]]).T
out['friedman'] = list(stats.friedmanchisquare(*m.T))
# two way anova type III
rows = []
import random
random.seed(1)
vals = {}
for i, r in enumerate(['R1', 'R2', 'R3']):
  for j, col in enumerate(['A', 'B']):
    n = 3 if (i + j) % 2 == 0 else 4
    vs = [round(10 + 2*i + 3*j + (i*j) + random.gauss(0, 1.5), 3) for _ in range(n)]
    vals[f'{i},{j}'] = vs
    for v in vs: rows.append({'row': r, 'col': col, 'y': v})
df = pd.DataFrame(rows)
model = ols('y ~ C(row, Sum) * C(col, Sum)', data=df).fit()
aov = sm.stats.anova_lm(model, typ=3)
out['twoway'] = {'cells': vals, 'F_row': aov.loc['C(row, Sum)', 'F'], 'F_col': aov.loc['C(col, Sum)', 'F'], 'F_int': aov.loc['C(row, Sum):C(col, Sum)', 'F'], 'p_int': aov.loc['C(row, Sum):C(col, Sum)', 'PR(>F)'], 'ss_res': aov.loc['Residual', 'sum_sq']}
out['fisher'] = stats.fisher_exact([[3, 12], [9, 4]])[1]
ct = stats.chi2_contingency([[20, 15, 8], [10, 22, 18]], correction=False)
out['chi2'] = [ct[0], ct[1]]
lr = stats.linregress(a[:7], b)
out['linreg'] = [lr.slope, lr.intercept, lr.rvalue**2, lr.pvalue, lr.stderr, lr.intercept_stderr]
x = np.array([-9, -8, -7, -6, -5, -4, -3], dtype=float)
y = np.array([2.1, 5.3, 18.0, 49.5, 82.1, 95.0, 98.2])
f4 = lambda x, b, t, l, h: b + (t - b) / (1 + 10**((l - x) * h))
popt, pcov = curve_fit(f4, x, y, p0=[0, 100, -6, 1])
out['fit4pl'] = {'x': x.tolist(), 'y': y.tolist(), 'p': popt.tolist(), 'se': np.sqrt(np.diag(pcov)).tolist()}
try:
  from lifelines.statistics import logrank_test
  t1 = [5, 8, 12, 15, 20, 22, 30, 35]; e1 = [1, 1, 0, 1, 1, 0, 1, 1]
  t2 = [10, 18, 25, 28, 33, 40, 45, 50]; e2 = [1, 0, 1, 1, 0, 1, 0, 1]
  r = logrank_test(t1, t2, e1, e2)
  out['logrank'] = {'t1': t1, 'e1': e1, 't2': t2, 'e2': e2, 'chi2': r.test_statistic, 'p': r.p_value}
except Exception as ex:
  out['logrank_err'] = str(ex)
out['data'] = {'a': a, 'b': b, 'c': c}
print(json.dumps(out))
