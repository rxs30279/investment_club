from django.conf import settings
from django.db import models
from datetime import datetime


class Stock(models.Model):
    ticker = models.CharField(max_length=20)
    name = models.CharField(max_length=20)
    create_date = models.DateTimeField(auto_now_add=True)
    originalPrice = models.FloatField(blank=True, null=True, default=0.00)
    date_updated = models.DateField(default=datetime.now, blank=True)

    def clean(self):
        self.ticker = self.ticker.upper()

    def __str__(self):
        return self.ticker
