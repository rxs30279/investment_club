from django.db import models


class Comp_model(models.Model):
    epic = models.CharField(max_length=10, default="")
    holding = models.FloatField()
    start_price = models.FloatField()

    def __str__(self):
        return self.epic
    
    class Meta:
        ordering = ['epic']
   
class Memebers(models.Model):
    first_name =models.CharField(max_length=100,blank=True)
    last_name =models.CharField(max_length=100,blank=True)
    
    member = models.ManyToManyField('Comp_model')

    def __str__(self):
        return self.first_name

