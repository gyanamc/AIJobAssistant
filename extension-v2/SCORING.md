# Compatibility scoring

The compatibility score represents evidence alignment between the saved resume
summary and the selected job. It is not a probability of being hired.

The three dimensions and full-assessment weights are:

- Skills: 40%
- Requirements: 35%
- Responsibilities: 25%

Within an assessed dimension, critical items have weight 2, important items have
weight 1, and preferred (`excellent`) items have weight 0.5. When a dimension is
unavailable, it remains `null`; it is never converted to zero. Available dimension
weights are normalized when calculating a partial score.

`scoreCoverage` records which dimensions are available, how many of the three were
assessed, the coverage percentage, and whether coverage is `full`, `partial`, or
`unavailable`. A numeric score may override the model's normalized `is_match`
classification only when at least two dimensions are available. With zero or one
dimension, the model decision remains the classification and the UI displays the
coverage limitation.
