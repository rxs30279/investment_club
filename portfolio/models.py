from django.db import models


class Mesi_model(models.Model):
    company = models.CharField(max_length=40)
    holding = models.IntegerField()
    total_cost = models.FloatField()
    industry = models.CharField(max_length=40, default="")
    index = models.CharField(max_length=20, default="")
    epic = models.CharField(max_length=10, default="")


def __str__(self):
    return self.comapny
